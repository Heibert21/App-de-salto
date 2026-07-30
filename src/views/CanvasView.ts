/**
 * ============================================================================
 * VISTA: CanvasView.ts
 * Responsabilidad: Renderizado visual en tiempo real en el elemento <canvas>:
 * esqueleto de cadera/piernas, línea base del suelo, indicador de pico y regla.
 *
 * Mejoras v2:
 *  - Overlay de posicionamiento: silueta fantasma cuando no hay landmarks.
 *  - Borde de estado: verde pulsante (buena señal) / rojo (señal mala).
 *  - Barra de confianza de pose: 5 segmentos, color rojo→verde, esquina superior derecha.
 *  - Pulso animado en la línea baseline cuando el estado es PREPARING.
 * ============================================================================
 */

import { NormalizedLandmark } from "../models/PoseModel";
import { JumpState } from "../models/JumpModel";

export class CanvasView {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private readonly mobile: boolean;

  // Animación de pulso para la línea baseline (PREPARING)
  private pulsePhase: number = 0;
  // Animación de borde verde (buena señal)
  private borderPhase: number = 0;

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
   * @param avgVisibility Visibilidad promedio de los keypoints [0, 1]
   */
  /**
   * Renderiza el marco visual completo: esqueleto, líneas de nivel y métricas.
   * @param avgVisibility Visibilidad promedio de los keypoints [0, 1]
   */
  public render(
    landmarks: NormalizedLandmark[] | null,
    baselineHipY: number | null,
    baselineAnkleY: number | null,
    isBaselineLocked: boolean,
    peakHipY: number,
    currentJumpCm: number,
    jumpState: JumpState,
    avgVisibility: number = 0
  ): void {
    this.clear();
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Avanzar fases de animación
    this.pulsePhase += 0.08;
    this.borderPhase += 0.05;

    // 1. Si no hay landmarks, mostrar silueta fantasma de posicionamiento
    if (!landmarks || landmarks.length < 33) {
      this.drawPositioningOverlay(width, height);
      return;
    }

    // 2. Dibujar borde de estado (verde/rojo según visibilidad)
    this.drawStatusBorder(width, height, avgVisibility);

    // 3. Dibujar barra de confianza de pose (esquina superior derecha)
    this.drawConfidenceBar(width, avgVisibility);

    // 4. Dibujar línea base del suelo (Baseline Cadera y Tobillos)
    if (baselineHipY !== null && baselineAnkleY !== null) {
      this.drawBaselineLines(width, baselineHipY, baselineAnkleY, jumpState, isBaselineLocked);
    }

    // 5. Dibujar línea del pico máximo de salto si está activo o en vuelo
    if (baselineHipY !== null && peakHipY < baselineHipY - 5) {
      this.drawPeakLine(width, peakHipY, currentJumpCm);
    }

    // 6. Dibujar esqueleto de la persona
    this.drawSkeleton(landmarks, width, height, jumpState);
  }

  // ── Overlay de posicionamiento ──────────────────────────────────────────

  /**
   * Dibuja una silueta fantasma semitransparente en el centro del canvas
   * para guiar al usuario sobre dónde posicionarse.
   */
  private drawPositioningOverlay(width: number, height: number): void {
    const cx = width / 2;
    const cy = height / 2;

    // Pulso suave para la silueta
    const alpha = 0.15 + 0.07 * Math.sin(this.pulsePhase);

    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.strokeStyle = "#00F2FE";
    this.ctx.lineWidth = 3;
    this.ctx.setLineDash([]);

    // Escala proporcional a la altura del canvas
    const scale = height * 0.55;

    // Cabeza
    const headR = scale * 0.065;
    const headCy = cy - scale * 0.38;
    this.ctx.beginPath();
    this.ctx.arc(cx, headCy, headR, 0, 2 * Math.PI);
    this.ctx.stroke();

    // Cuerpo (torso)
    const shoulderY = headCy + headR + scale * 0.04;
    const hipY = shoulderY + scale * 0.28;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, shoulderY);
    this.ctx.lineTo(cx, hipY);
    this.ctx.stroke();

    // Hombros
    const shoulderW = scale * 0.15;
    this.ctx.beginPath();
    this.ctx.moveTo(cx - shoulderW, shoulderY);
    this.ctx.lineTo(cx + shoulderW, shoulderY);
    this.ctx.stroke();

    // Brazos
    const elbowY = shoulderY + scale * 0.18;
    this.ctx.beginPath();
    this.ctx.moveTo(cx - shoulderW, shoulderY);
    this.ctx.lineTo(cx - shoulderW * 1.3, elbowY);
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.moveTo(cx + shoulderW, shoulderY);
    this.ctx.lineTo(cx + shoulderW * 1.3, elbowY);
    this.ctx.stroke();

    // Piernas
    const hipW = scale * 0.1;
    const kneeY = hipY + scale * 0.22;
    const footY = kneeY + scale * 0.22;
    // Cadera izquierda → rodilla → pie
    this.ctx.beginPath();
    this.ctx.moveTo(cx - hipW, hipY);
    this.ctx.lineTo(cx - hipW * 1.1, kneeY);
    this.ctx.lineTo(cx - hipW * 1.15, footY);
    this.ctx.stroke();
    // Cadera derecha → rodilla → pie
    this.ctx.beginPath();
    this.ctx.moveTo(cx + hipW, hipY);
    this.ctx.lineTo(cx + hipW * 1.1, kneeY);
    this.ctx.lineTo(cx + hipW * 1.15, footY);
    this.ctx.stroke();

    this.ctx.globalAlpha = 1;
    this.ctx.restore();

    // Texto de guía
    this.ctx.save();
    const textAlpha = 0.6 + 0.3 * Math.sin(this.pulsePhase);
    this.ctx.globalAlpha = textAlpha;
    this.ctx.fillStyle = "#00F2FE";
    this.ctx.font = `bold ${Math.max(14, height * 0.022)}px 'Outfit', sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.fillText("El video debe mostrar el cuerpo completo", cx, cy + height * 0.33);
    this.ctx.font = `${Math.max(11, height * 0.017)}px 'Outfit', sans-serif`;
    this.ctx.fillStyle = "rgba(255,255,255,0.7)";
    this.ctx.fillText("De pies a cabeza para mejor precisión", cx, cy + height * 0.33 + height * 0.03);
    this.ctx.restore();
  }

  // ── Borde de estado ─────────────────────────────────────────────────────

  /**
   * Dibuja un borde interior en el canvas coloreado según la calidad de pose.
   * Verde pulsante = buena señal (>0.7); rojo tenue = mala señal (<0.4); ninguno = regular.
   */
  private drawStatusBorder(width: number, height: number, avgVisibility: number): void {
    if (avgVisibility >= 0.7) {
      const alpha = 0.25 + 0.2 * Math.abs(Math.sin(this.borderPhase));
      this.ctx.save();
      this.ctx.strokeStyle = `rgba(0, 230, 100, ${alpha})`;
      this.ctx.lineWidth = 8;
      this.ctx.strokeRect(4, 4, width - 8, height - 8);
      this.ctx.restore();
    } else if (avgVisibility < 0.4 && avgVisibility > 0) {
      this.ctx.save();
      this.ctx.strokeStyle = "rgba(255, 60, 60, 0.3)";
      this.ctx.lineWidth = 6;
      this.ctx.strokeRect(4, 4, width - 8, height - 8);
      this.ctx.restore();
    }
  }

  // ── Barra de confianza ──────────────────────────────────────────────────

  /**
   * Dibuja una barra de confianza de pose en la esquina superior derecha (5 segmentos).
   */
  private drawConfidenceBar(width: number, avgVisibility: number): void {
    const segments = 5;
    const filled = Math.round(avgVisibility * segments);
    const barW = 16;
    const barH = 8;
    const gap = 3;
    const totalW = segments * barW + (segments - 1) * gap;
    const startX = width - totalW - 12;
    const startY = 12;

    this.ctx.save();

    // Fondo semitransparente
    this.ctx.fillStyle = "rgba(0,0,0,0.45)";
    this.ctx.beginPath();
    this.ctx.roundRect(startX - 6, startY - 4, totalW + 12, barH + 16, 4);
    this.ctx.fill();

    // Segmentos
    for (let i = 0; i < segments; i++) {
      const x = startX + i * (barW + gap);
      const ratio = i / (segments - 1);
      // Gradiente: rojo → amarillo → verde
      const r = Math.round(255 * (1 - ratio));
      const g = Math.round(200 * ratio + 55);
      const active = i < filled;
      this.ctx.fillStyle = active
        ? `rgb(${r}, ${g}, 50)`
        : "rgba(255,255,255,0.12)";
      this.ctx.beginPath();
      this.ctx.roundRect(x, startY, barW, barH, 2);
      this.ctx.fill();
    }

    // Etiqueta "SEÑAL"
    this.ctx.fillStyle = "rgba(255,255,255,0.65)";
    this.ctx.font = `bold ${Math.max(8, 9)}px 'Space Mono', monospace`;
    this.ctx.textAlign = "center";
    this.ctx.fillText("SEÑAL", startX + totalW / 2, startY + barH + 10);

    this.ctx.restore();
  }

  // ── Líneas baseline (Cadera y Tobillos/Suelo) ──────────────────────────

  /**
   * Dibuja las líneas horizontales del nivel de suelo en los pies y cadera.
   */
  private drawBaselineLines(
    width: number,
    hipY: number,
    ankleY: number,
    jumpState: JumpState,
    isLocked: boolean
  ): void {
    const isPreparing = jumpState === 'PREPARING';

    this.ctx.save();

    // 1. Línea Base en Suelo (Tobillos)
    this.ctx.beginPath();
    const ankleAlpha = isLocked ? 0.9 : (0.4 + 0.4 * Math.abs(Math.sin(this.pulsePhase * 2)));
    this.ctx.strokeStyle = isLocked ? "rgba(0, 230, 118, 0.85)" : `rgba(255, 215, 0, ${ankleAlpha})`;
    this.ctx.lineWidth = isLocked ? 2.5 : 2;
    this.ctx.setLineDash(isLocked ? [] : [6, 4]);
    this.ctx.moveTo(0, ankleY);
    this.ctx.lineTo(width, ankleY);
    this.ctx.stroke();

    // Etiqueta Suelo
    this.ctx.fillStyle = isLocked ? "#00E676" : "#FFD700";
    this.ctx.font = "bold 11px 'Space Mono', monospace";
    this.ctx.textAlign = "left";
    const statusText = isLocked ? "🔒 SUELO FIJADO" : "⏳ CALIBRANDO SUELO (Quedate quieto)";
    this.ctx.fillText(`--- ${statusText} ---`, 16, ankleY - 6);

    // 2. Línea Base de Cadera
    this.ctx.beginPath();
    this.ctx.strokeStyle = `rgba(0, 242, 254, ${isPreparing ? 0.9 : 0.45})`;
    this.ctx.lineWidth = 1.5;
    this.ctx.setLineDash([8, 6]);
    this.ctx.moveTo(0, hipY);
    this.ctx.lineTo(width, hipY);
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(0, 242, 254, 0.7)";
    this.ctx.fillText(
      isPreparing ? "--- FLEXIONANDO ---" : "--- REF. CADERA ---",
      16,
      hipY - 6
    );

    this.ctx.restore();
  }

  // ── Línea de pico ───────────────────────────────────────────────────────

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
    this.ctx.textAlign = "right";
    this.ctx.fillText(`▲ PICO ALCANZADO: ${currentCm.toFixed(1)} cm`, width - 12, y - 8);
    this.ctx.restore();
  }

  // ── Esqueleto ───────────────────────────────────────────────────────────

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
