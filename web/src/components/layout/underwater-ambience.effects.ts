// ============================================================
// Drawing functions for UnderwaterAmbience (ROK-712)
// ============================================================

import type { LightShaft, CausticNode, Leviathan } from './underwater-ambience.types';

export function drawLightShafts(ctx: CanvasRenderingContext2D, shafts: LightShaft[], canvasH: number, now: number) {
    ctx.save();
    for (const shaft of shafts) {
        shaft.swayPhase += shaft.swaySpeed;
        const sway = Math.sin(shaft.swayPhase) * shaft.swayAmp;
        const topX = shaft.x + sway;
        const halfTop = shaft.width / 2;
        const halfBottom = halfTop * shaft.spread;
        const tilt = -canvasH * 0.18;

        const grad = ctx.createLinearGradient(topX, 0, topX + tilt * 0.5, canvasH * 0.9);
        const pulse = 0.85 + 0.15 * Math.sin(now * 0.0003 + shaft.swayPhase);
        const alpha = shaft.opacity * pulse;
        grad.addColorStop(0, `rgba(180, 225, 245, ${(alpha * 1.5).toFixed(4)})`);
        grad.addColorStop(0.15, `rgba(160, 215, 235, ${(alpha * 1.2).toFixed(4)})`);
        grad.addColorStop(0.4, `rgba(130, 200, 220, ${(alpha * 0.7).toFixed(4)})`);
        grad.addColorStop(0.7, `rgba(110, 190, 210, ${(alpha * 0.3).toFixed(4)})`);
        grad.addColorStop(1, 'rgba(100, 180, 200, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(topX - halfTop, 0);
        ctx.lineTo(topX + halfTop, 0);
        ctx.lineTo(topX + halfBottom + tilt, canvasH * 0.9);
        ctx.lineTo(topX - halfBottom + tilt, canvasH * 0.9);
        ctx.closePath();
        ctx.fill();
    }
    ctx.restore();
}

export function drawCaustics(ctx: CanvasRenderingContext2D, nodes: CausticNode[]) {
    ctx.save();
    for (const node of nodes) {
        node.phase += node.speed;
        const pulse = 0.5 + 0.5 * Math.sin(node.phase);
        const alpha = 0.035 * pulse;
        const r = node.radius * (0.9 + 0.3 * pulse);

        const grad = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r);
        grad.addColorStop(0, `rgba(160, 235, 245, ${alpha.toFixed(4)})`);
        grad.addColorStop(0.25, `rgba(140, 225, 235, ${(alpha * 0.7).toFixed(4)})`);
        grad.addColorStop(0.55, `rgba(120, 215, 225, ${(alpha * 0.3).toFixed(4)})`);
        grad.addColorStop(1, 'rgba(100, 200, 210, 0)');

        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
        ctx.fill();
    }
    ctx.restore();
}

export function drawFishSilhouette(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, direction: 1 | -1, opacity: number) {
    ctx.save();
    ctx.globalAlpha = Math.min(opacity * 2.5, 1);
    ctx.fillStyle = '#90dce8';
    ctx.shadowColor = '#34ffc4';
    ctx.shadowBlur = size * 6;
    ctx.translate(x, y);
    if (direction === -1) ctx.scale(-1, 1);

    const bodyW = size;
    const bodyH = size * 0.45;
    ctx.beginPath();
    ctx.ellipse(0, 0, bodyW / 2, bodyH / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-bodyW / 2, 0);
    ctx.lineTo(-bodyW / 2 - size * 0.35, -bodyH * 0.6);
    ctx.lineTo(-bodyW / 2 - size * 0.35, bodyH * 0.6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
}

export function drawLeviathan(ctx: CanvasRenderingContext2D, lev: Leviathan) {
    ctx.save();
    ctx.translate(lev.x, lev.y);
    if (lev.direction === -1) ctx.scale(-1, 1);

    const w = lev.width;
    const h = lev.height;

    const grad = ctx.createRadialGradient(0, 0, 0, w * 0.05, 0, w * 0.55);
    const a = lev.opacity;
    grad.addColorStop(0, `rgba(106, 184, 208, ${(a * 0.8).toFixed(4)})`);
    grad.addColorStop(0.4, `rgba(80, 160, 190, ${(a * 0.5).toFixed(4)})`);
    grad.addColorStop(0.7, `rgba(52, 255, 196, ${(a * 0.15).toFixed(4)})`);
    grad.addColorStop(1, 'rgba(52, 255, 196, 0)');

    ctx.fillStyle = grad;
    ctx.shadowColor = '#34ffc4';
    ctx.shadowBlur = w * 0.3;

    ctx.beginPath();
    ctx.ellipse(0, 0, w * 0.5, h * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const tailGrad = ctx.createRadialGradient(-w * 0.45, 0, 0, -w * 0.45, 0, w * 0.18);
    tailGrad.addColorStop(0, `rgba(90, 170, 195, ${(a * 0.4).toFixed(4)})`);
    tailGrad.addColorStop(1, 'rgba(90, 170, 195, 0)');
    ctx.fillStyle = tailGrad;
    ctx.beginPath();
    ctx.ellipse(-w * 0.45, 0, w * 0.18, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}
