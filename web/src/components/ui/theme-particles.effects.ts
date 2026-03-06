export function drawAurora(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const bands = [
        { yCenter: h * 0.14, ySpread: h * 0.12, color: '#00FF88', speed: 0.28, freq: 0.006, phase: 0 },
        { yCenter: h * 0.20, ySpread: h * 0.10, color: '#22CCFF', speed: 0.22, freq: 0.005, phase: 2.1 },
        { yCenter: h * 0.10, ySpread: h * 0.08, color: '#9966FF', speed: 0.18, freq: 0.007, phase: 4.2 },
    ];

    ctx.save();
    for (const band of bands) {
        ctx.globalAlpha = 0.11 + Math.sin(t * 0.4 + band.phase) * 0.04;
        ctx.beginPath();
        ctx.moveTo(0, band.yCenter - band.ySpread);
        for (let x = 0; x <= w; x += 6) {
            const wave = Math.sin(x * band.freq + t * band.speed + band.phase);
            ctx.lineTo(x, band.yCenter - band.ySpread + wave * band.ySpread * 0.5);
        }
        for (let x = w; x >= 0; x -= 6) {
            const wave = Math.sin(x * band.freq + t * band.speed + band.phase + 0.6);
            ctx.lineTo(x, band.yCenter + band.ySpread + wave * band.ySpread * 0.4);
        }
        ctx.closePath();
        const grad = ctx.createLinearGradient(0, band.yCenter - band.ySpread, 0, band.yCenter + band.ySpread);
        grad.addColorStop(0, 'transparent');
        grad.addColorStop(0.15, `${band.color}18`);
        grad.addColorStop(0.35, `${band.color}80`);
        grad.addColorStop(0.5, band.color);
        grad.addColorStop(0.65, `${band.color}80`);
        grad.addColorStop(0.85, `${band.color}18`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.fill();
    }
    ctx.restore();
}

export function drawLavaGlow(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    ctx.save();
    const pulse = 0.5 + Math.sin(t * 0.9) * 0.5;
    const baseAlpha = 0.14 + pulse * 0.18;
    const baseGrad = ctx.createLinearGradient(0, h * 0.62, 0, h);
    baseGrad.addColorStop(0, 'transparent');
    baseGrad.addColorStop(0.4, `rgba(160, 30, 0, ${baseAlpha * 0.5})`);
    baseGrad.addColorStop(1, `rgba(240, 70, 0, ${baseAlpha})`);
    ctx.fillStyle = baseGrad;
    ctx.fillRect(0, h * 0.62, w, h * 0.38);

    const spots = [
        { xFrac: 0.15, intensity: 0.45 + Math.sin(t * 1.1) * 0.35 },
        { xFrac: 0.45, intensity: 0.40 + Math.sin(t * 0.9 + 1.2) * 0.35 },
        { xFrac: 0.75, intensity: 0.42 + Math.sin(t * 1.0 + 2.4) * 0.35 },
    ];
    for (const spot of spots) {
        const sx = w * spot.xFrac;
        const r = w * 0.32;
        const rg = ctx.createRadialGradient(sx, h, 0, sx, h, r);
        rg.addColorStop(0, `rgba(255, 90, 0, ${spot.intensity * 0.35})`);
        rg.addColorStop(0.35, `rgba(200, 40, 0, ${spot.intensity * 0.18})`);
        rg.addColorStop(0.7, `rgba(120, 15, 0, ${spot.intensity * 0.07})`);
        rg.addColorStop(1, 'transparent');
        ctx.globalAlpha = 1;
        ctx.fillStyle = rg;
        ctx.fillRect(0, h * 0.5, w, h * 0.5);
    }
    ctx.restore();
}

export function drawSun(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
    const sx = w * 0.12;
    const sy = h * 0.10;
    const base = Math.min(w, h) * 0.07;
    const pulse = 1 + Math.sin(t * 0.28) * 0.04;

    ctx.save();

    const bloom = ctx.createRadialGradient(sx, sy, 0, sx, sy, base * 5 * pulse);
    bloom.addColorStop(0, 'rgba(255, 200, 60, 0.14)');
    bloom.addColorStop(0.25, 'rgba(255, 160, 40, 0.09)');
    bloom.addColorStop(0.55, 'rgba(240, 110, 20, 0.04)');
    bloom.addColorStop(1, 'transparent');
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.arc(sx, sy, base * 5 * pulse, 0, Math.PI * 2);
    ctx.fill();

    const halo = ctx.createRadialGradient(sx, sy, 0, sx, sy, base * 2.2 * pulse);
    halo.addColorStop(0, 'rgba(255, 220, 100, 0.30)');
    halo.addColorStop(0.5, 'rgba(255, 170, 50, 0.18)');
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(sx, sy, base * 2.2 * pulse, 0, Math.PI * 2);
    ctx.fill();

    const core = ctx.createRadialGradient(sx, sy, 0, sx, sy, base * pulse);
    core.addColorStop(0, 'rgba(255, 240, 180, 0.55)');
    core.addColorStop(0.5, 'rgba(255, 200, 80, 0.40)');
    core.addColorStop(1, 'transparent');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(sx, sy, base * pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
}

export function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
    const points = 4;
    const outer = size;
    const inner = size * 0.4;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
        const angle = (i * Math.PI) / points - Math.PI / 2;
        const r = i % 2 === 0 ? outer : inner;
        if (i === 0) ctx.moveTo(x + r * Math.cos(angle), y + r * Math.sin(angle));
        else ctx.lineTo(x + r * Math.cos(angle), y + r * Math.sin(angle));
    }
    ctx.closePath();
    ctx.fill();
}
