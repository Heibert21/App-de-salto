/**
 * ============================================================================
 * MODELO: JumpModel.ts
 * Responsabilidad: Lógica de negocio del salto usando fórmula de física
 * cinemática (h = g × t² / 8) basada en el tiempo de vuelo.
 * No requiere conocer la estatura del usuario.
 * ============================================================================
 */

import { NormalizedLandmark } from "./PoseModel";

export type JumpState = 'IDLE' | 'PREPARING' | 'IN_AIR' | 'LANDED';

// Constante de gravedad terrestre en cm/s²
const GRAVITY_CM_S2 = 981;

export class JumpModel {
  // Calibración visual (solo para dibujar en canvas, no para la medición real)
  private baselineHipY: number | null = null; // Coordenada Y de la cadera en reposo (en píxeles)

  // Estado del salto
  private currentState: JumpState = 'IDLE';
  private currentJumpCm: number = 0;
  private peakJumpCm: number = 0;
  private maxJumpCm: number = 0;
  private peakHipY: number = Infinity; // Mínima Y alcanzada en el salto (más arriba en canvas)

  // Tiempos y visualización
  private flightStartTime: number = 0;
  private lastFlightTimeMs: number = 0;
  private landedResetTimer: number | null = null;

  // Umbrales en porcentaje de la altura del video (independientes de escala)
  // 1.5% del alto del canvas como umbral de despegue (~10px en 720p)
  private jumpThresholdRatio: number = 0.015;
  // 2% del alto del canvas como umbral de flexión previa (~14px en 720p)
  private crouchThresholdRatio: number = 0.02;

  // Callback al completar salto
  public onJumpCompleted?: (peakJumpCm: number) => void;

  private static readonly STORAGE_KEY = 'youcanfly_record_cm';

  constructor() {
    // Recuperar récord guardado en localStorage (persiste entre sesiones)
    const saved = parseFloat(localStorage.getItem(JumpModel.STORAGE_KEY) ?? '0');
    if (!isNaN(saved) && saved > 0) {
      this.maxJumpCm = saved;
    }
  }

  // ── Getters públicos ──

  public getBaselineHipY(): number | null {
    return this.baselineHipY;
  }

  public getCurrentJumpCm(): number {
    return Math.max(0, this.currentJumpCm);
  }

  public getMaxJumpCm(): number {
    return this.maxJumpCm;
  }

  public getCurrentState(): JumpState {
    return this.currentState;
  }

  public getPeakHipY(): number {
    return this.peakHipY;
  }

  public getLastFlightTimeMs(): number {
    return this.lastFlightTimeMs;
  }

  /**
   * Calcula la altura del salto en centímetros usando la fórmula de cinemática:
   *   h = (g × t²) / 8
   * Donde t es el tiempo total de vuelo en segundos y g = 981 cm/s².
   * Esta fórmula se deriva de que el tiempo de vuelo total es t = 2 × sqrt(2h/g),
   * por lo tanto h = g × t² / 8.
   */
  private calculateJumpHeightFromFlightTime(flightTimeMs: number): number {
    const t = flightTimeMs / 1000; // convertir a segundos
    const h = (GRAVITY_CM_S2 * t * t) / 8;
    return h;
  }

  /**
   * Calibra la línea de suelo (baseline) usando la posición actual de la cadera.
   * NO necesita la estatura del usuario.
   */
  public calibrateBaseline(landmarks: NormalizedLandmark[], canvasHeight: number): void {
    if (!landmarks || landmarks.length < 33) return;

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    // Centro de cadera en píxeles
    const hipYPx = ((leftHip.y + rightHip.y) / 2) * canvasHeight;
    this.baselineHipY = hipYPx;

    // Reiniciar pico actual
    this.peakHipY = hipYPx;
    this.currentJumpCm = 0;
    this.currentState = 'IDLE';
  }

  /**
   * Procesa la posición actual de los landmarks y actualiza la máquina de estados.
   * La altura se calcula con el método de tiempo de vuelo (física), sin necesidad
   * de calibración de estatura.
   */
  public processFrame(landmarks: NormalizedLandmark[], canvasHeight: number, nowMs: number): void {
    if (!landmarks || landmarks.length < 33) return;

    const leftHip = landmarks[23];
    const rightHip = landmarks[24];

    // Coordenada Y actual de la cadera en píxeles (0 está arriba, canvasHeight está abajo)
    const currentHipY = ((leftHip.y + rightHip.y) / 2) * canvasHeight;

    // Si aún no hay línea de base fijada, calibramos automáticamente
    if (this.baselineHipY === null) {
      this.calibrateBaseline(landmarks, canvasHeight);
      return;
    }

    // Distancia vertical respecto a la línea de base (en píxeles)
    // Recordatorio: En Canvas, elevación hacia arriba significa Y MENOR que baselineHipY
    const deltaYPx = this.baselineHipY - currentHipY;

    // Umbrales de detección en píxeles (basados en proporción del alto del canvas)
    const jumpThresholdPx = canvasHeight * this.jumpThresholdRatio;
    const crouchThresholdPx = canvasHeight * this.crouchThresholdRatio;

    switch (this.currentState) {
      case 'IDLE':
        this.currentJumpCm = 0;

        // Si la cadera desciende bastante -> Flexión previa (PREPARING)
        if (currentHipY > this.baselineHipY + crouchThresholdPx) {
          this.currentState = 'PREPARING';
        }
        // O si despega directamente hacia arriba -> IN_AIR
        else if (deltaYPx > jumpThresholdPx) {
          this.transitionToAir(currentHipY, nowMs);
        }
        break;

      case 'PREPARING':
        this.currentJumpCm = 0;

        // Al impulsarse hacia arriba y superar la baseline -> EN EL AIRE
        if (deltaYPx > jumpThresholdPx) {
          this.transitionToAir(currentHipY, nowMs);
        }
        // Si vuelve a la posición erguida sin saltar -> IDLE
        else if (Math.abs(deltaYPx) < jumpThresholdPx) {
          this.currentState = 'IDLE';
        }
        break;

      case 'IN_AIR':
        // Registrar la altura máxima alcanzada (mínima coordenada Y)
        if (currentHipY < this.peakHipY) {
          this.peakHipY = currentHipY;
        }

        // Calcular la altura estimada en vivo usando el tiempo parcial de vuelo
        const partialFlightMs = nowMs - this.flightStartTime;
        this.currentJumpCm = this.calculateJumpHeightFromFlightTime(partialFlightMs);

        // Detección de aterrizaje: la cadera vuelve a la cercanía de la base
        if (deltaYPx <= jumpThresholdPx / 2) {
          this.currentState = 'LANDED';
          this.lastFlightTimeMs = nowMs - this.flightStartTime;

          // Calcular altura final del salto con el tiempo de vuelo real
          this.peakJumpCm = this.calculateJumpHeightFromFlightTime(this.lastFlightTimeMs);
          this.currentJumpCm = this.peakJumpCm;

          // Registrar nuevo récord si aplica
          if (this.peakJumpCm > this.maxJumpCm) {
            this.maxJumpCm = Number(this.peakJumpCm.toFixed(1));
            // Persistir récord en localStorage
            localStorage.setItem(JumpModel.STORAGE_KEY, String(this.maxJumpCm));
          }

          // Notificar al controlador que el salto fue medido exitosamente
          if (this.onJumpCompleted) {
            this.onJumpCompleted(this.peakJumpCm);
          }

          // Temporizador para regresar al estado IDLE tras mostrar el resultado del salto
          if (this.landedResetTimer) window.clearTimeout(this.landedResetTimer);
          this.landedResetTimer = window.setTimeout(() => {
            if (this.currentState === 'LANDED') {
              this.currentState = 'IDLE';
              if (this.baselineHipY !== null) {
                this.peakHipY = this.baselineHipY;
              }
            }
          }, 3000);
        }
        break;

      case 'LANDED':
        // Mantiene visible el resultado del pico del salto registrado
        this.currentJumpCm = this.peakJumpCm;

        // Si empieza a saltar de nuevo inmediatamente
        if (deltaYPx > jumpThresholdPx) {
          if (this.landedResetTimer) window.clearTimeout(this.landedResetTimer);
          this.transitionToAir(currentHipY, nowMs);
        }
        break;
    }
  }

  private transitionToAir(initialHipY: number, nowMs: number): void {
    this.currentState = 'IN_AIR';
    this.peakHipY = initialHipY;
    this.flightStartTime = nowMs;
  }

  /**
   * Reinicia la métrica de récord máximo.
   */
  public resetRecord(): void {
    this.maxJumpCm = 0;
    this.peakJumpCm = 0;
    this.currentJumpCm = 0;
    localStorage.removeItem(JumpModel.STORAGE_KEY);
  }
}
