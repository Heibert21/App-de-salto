/**
 * ============================================================================
 * VISTA: CanvasView.ts
 * Responsabilidad: Renderizado visual en tiempo real en el elemento <canvas>:
 * esqueleto de cadera/piernas, línea base del suelo, indicador de pico y regla.
 * ============================================================================
 */

import { NormalizedLandmark } from "../models/PoseModel";
import { JumpState } from "../models/JumpModel";

export class CanvasView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly mobile: boolean;

  constructor(canvasElement: HTMLCanvasElement, isMobile: boolean = false) {
    this.canvas = canvasElement;
    this.mobile = isMobile;
    const context = this.canvas.getContext("2d");
    if (!context) {
      throw new Error("No se pudo obtener el contexto 2D del Canvas");
    }
    this.ctx = context;
  }

  /**
   * Sincroniza el tamaño del canvas con el del video contenedor.
   */
  public resize(width: number, height: number): void {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Limpia el contenido del canvas.
   */
  public clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * Renderiza el marco visual completo: esqueleto, líneas de nivel y métricas.
   */
  public render(
    landmarks: NormalizedLandmark[] | null,
    baselineHipY: number | null,
    peakHipY: number,
    currentJumpCm: number,
    jumpState: JumpState
  ): void {
    this.clear();
    const width = this.canvas.width;
    const height = this.canvas.height;

    // 1. Dibujar línea base del suelo (Baseline Y)
    if (baselineHipY !== null) {
      this.drawBaselineLine(width, baselineHipY);
    }

    // 2. Dibujar línea del pico máximo de salto si está activo o en vuelo
    if (baselineHipY !== null && peakHipY < baselineHipY - 5) {
      const peakJumpCm = (baselineHipY - peakHipY) * (currentJumpCm / (baselineHipY - peakHipY || 1));
      this.drawPeakLine(width, peakHipY, currentJumpCm);
    }

    // 3. Dibujar esqueleto de la persona si hay landmarks detectados
    if (landmarks && landmarks.length >= 33) {
      this.drawSkeleton(landmarks, width, height, jumpState);
    }
  }

  /**
   * Dibuja la línea horizontal del nivel del suelo (Baseline Hip Y)
   */
  private drawBaselineLine(width: number, y: number): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.strokeStyle = "rgba(0, 242, 254, 0.8)";
    this.ctx.lineWidth = 2;
    this.ctx.setLineDash([8, 6]); // Línea punteada neón
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(width, y);
    this.ctx.stroke();

    // Etiqueta de suelo
    this.ctx.fillStyle = "#00F2FE";
    this.ctx.font = "bold 12px 'Space Mono', monospace";
    this.ctx.fillText("--- LÍNEA BASE (SUELO) ---", 16, y - 6);
    this.ctx.restore();
  }

  /**
   * Dibuja la línea de cota máxima del salto
   */
  private drawPeakLine(width: number, y: number, currentCm: number): void {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.strokeStyle = "rgba(255, 215, 0, 0.9)";
    this.ctx.lineWidth = 3;
    if (!this.mobile) {
      // shadowBlur es muy costoso en móvil (se ejecuta en software)
      this.ctx.shadowColor = "#FFD700";
      this.ctx.shadowBlur = 10;
    }
    this.ctx.moveTo(0, y);
    this.ctx.lineTo(width, y);
    this.ctx.stroke();

    // Etiqueta del pico en cm
    this.ctx.fillStyle = "#FFD700";
    this.ctx.font = "bold 14px 'Outfit', sans-serif";
    this.ctx.fillText(`▲ PICO ALCANZADO: ${currentCm.toFixed(1)} cm`, width - 210, y - 8);
    this.ctx.restore();
  }

  /**
   * Dibuja los puntos clave (Keypoints) y las conexiones de piernas/cadera
   */
  private drawSkeleton(
    landmarks: NormalizedLandmark[],
    width: number,
    height: number,
    state: JumpState
  ): void {
    // Conexiones de la parte inferior (Caderas, rodillas, tobillos, pies)
    const connections = [
      [23, 24], // Cadera izquierda -> Cadera derecha
      [23, 25], // Cadera Izq -> Rodilla Izq
      [25, 27], // Rodilla Izq -> Tobillo Izq
      [27, 29], // Tobillo Izq -> Talón Izq
      [27, 31], // Tobillo Izq -> Pie Izq
      [24, 26], // Cadera Der -> Rodilla Der
      [26, 28], // Rodilla Der -> Tobillo Der
      [28, 30], // Tobillo Der -> Talón Der
      [28, 32], // Tobillo Der -> Pie Der
      [11, 23], // Hombro Izq -> Cadera Izq
      [12, 24], // Hombro Der -> Cadera Der
    ];

    const isAir = state === 'IN_AIR';
    const strokeColor = isAir ? "#00F2FE" : "rgba(255, 255, 255, 0.85)";
    const glowColor = isAir ? "#00F2FE" : "rgba(79, 172, 254, 0.5)";

    this.ctx.save();
    this.ctx.lineWidth = isAir ? 4 : 3;
    this.ctx.strokeStyle = strokeColor;
    if (!this.mobile) {
      // shadowBlur es la operación más costosa del canvas en móvil
      this.ctx.shadowColor = glowColor;
      this.ctx.shadowBlur = isAir ? 12 : 6;
    }

    // Dibujar líneas entre articulaciones
    connections.forEach(([i, j]) => {
      const p1 = landmarks[i];
      const p2 = landmarks[j];

      if (p1 && p2 && (p1.visibility ?? 1) > 0.4 && (p2.visibility ?? 1) > 0.4) {
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x * width, p1.y * height);
        this.ctx.lineTo(p2.x * width, p2.y * height);
        this.ctx.stroke();
      }
    });

    // Dibujar nodos/puntos clave
    const keypointIndices = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
    keypointIndices.forEach((idx) => {
      const lm = landmarks[idx];
      if (lm && (lm.visibility ?? 1) > 0.4) {
        const x = lm.x * width;
        const y = lm.y * height;

        this.ctx.beginPath();
        this.ctx.arc(x, y, isAir ? 6 : 5, 0, 2 * Math.PI);
        this.ctx.fillStyle = idx === 23 || idx === 24 ? "#FFD700" : "#00F2FE";
        this.ctx.fill();
        this.ctx.strokeStyle = "#FFFFFF";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
      }
    });

    // Marcar el centro de gravedad / centro de caderas
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    if (leftHip && rightHip) {
      const hipCenterX = ((leftHip.x + rightHip.x) / 2) * width;
      const hipCenterY = ((leftHip.y + rightHip.y) / 2) * height;

      this.ctx.beginPath();
      this.ctx.arc(hipCenterX, hipCenterY, 8, 0, 2 * Math.PI);
      this.ctx.fillStyle = "#FF007F"; // Rosa Neón para el centro de cadera
      this.ctx.fill();
      this.ctx.strokeStyle = "#FFFFFF";
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }

    this.ctx.restore();
  }
}
