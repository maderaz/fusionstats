// Isometric vault primitives using SVG.
// Pure geometric — top face, two side faces, glow gradient, optional grid floor.

const IsoCube = ({ size = 280, glow = true, label = null, floor = true, style = {} }) => {
  // Isometric projection: 30deg angles. Cube projected to a 2:sqrt(3) ratio diamond.
  const w = size;
  const h = size * 1.05;
  const cx = w / 2;
  // Top diamond points (top face)
  const topY = h * 0.18;
  const midY = h * 0.5;
  const botY = h * 0.82;
  const halfW = w * 0.42;
  const id = React.useId().replace(/:/g, '');

  return (
    <div style={{ position: 'relative', width: w, height: h, ...style }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <linearGradient id={`top-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#A37FFF" />
            <stop offset="100%" stopColor="#6C00FF" />
          </linearGradient>
          <linearGradient id={`leftFace-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(132, 41, 255, 0.18)" />
            <stop offset="100%" stopColor="rgba(132, 41, 255, 0.04)" />
          </linearGradient>
          <linearGradient id={`rightFace-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(108, 0, 255, 0.22)" />
            <stop offset="100%" stopColor="rgba(108, 0, 255, 0.06)" />
          </linearGradient>
          <radialGradient id={`glow-${id}`} cx="0.5" cy="0.55" r="0.55">
            <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.0)" />
          </radialGradient>
          <pattern id={`grid-${id}`} width={w * 0.06} height={w * 0.035} patternUnits="userSpaceOnUse" patternTransform="skewX(-30)">
            <rect width={w * 0.06} height={w * 0.035} fill="none" />
            <path d={`M0 0 L${w * 0.06} 0 M0 0 L0 ${w * 0.035}`} stroke="rgba(132,41,255,0.18)" strokeWidth="0.6" />
          </pattern>
        </defs>

        {/* Floor grid */}
        {floor && (
          <g opacity="0.6">
            {Array.from({ length: 8 }).map((_, i) => {
              const t = i / 7;
              const y = h * 0.85 + (h * 0.15 - 0) * t * 0.0;
              return null;
            })}
            {/* Iso grid floor */}
            <g transform={`translate(${cx}, ${botY + 4})`}>
              {Array.from({ length: 9 }).map((_, i) => {
                const o = (i - 4) * (w * 0.08);
                return (
                  <g key={i}>
                    <line x1={o} y1={0} x2={o + halfW * 1.1} y2={halfW * 0.55} stroke="rgba(132,41,255,0.15)" strokeWidth="0.6" />
                    <line x1={o} y1={0} x2={o - halfW * 1.1} y2={halfW * 0.55} stroke="rgba(132,41,255,0.15)" strokeWidth="0.6" />
                  </g>
                );
              })}
            </g>
          </g>
        )}

        {/* Glow behind cube */}
        {glow && <ellipse cx={cx} cy={midY + 10} rx={halfW * 1.1} ry={halfW * 0.7} fill={`url(#glow-${id})`} />}

        {/* Right face */}
        <path
          d={`M ${cx} ${midY} L ${cx + halfW} ${topY + (midY - topY) * 0.65} L ${cx + halfW} ${botY - (botY - midY) * 0.35} L ${cx} ${botY}`}
          fill={`url(#rightFace-${id})`}
          stroke="rgba(132,41,255,0.55)"
          strokeWidth="1.1"
        />
        {/* Left face */}
        <path
          d={`M ${cx} ${midY} L ${cx - halfW} ${topY + (midY - topY) * 0.65} L ${cx - halfW} ${botY - (botY - midY) * 0.35} L ${cx} ${botY}`}
          fill={`url(#leftFace-${id})`}
          stroke="rgba(132,41,255,0.45)"
          strokeWidth="1.1"
        />

        {/* Top face (solid purple gradient) */}
        <path
          d={`M ${cx} ${topY} L ${cx + halfW} ${topY + (midY - topY) * 0.65} L ${cx} ${midY} L ${cx - halfW} ${topY + (midY - topY) * 0.65} Z`}
          fill={`url(#top-${id})`}
          stroke="rgba(108,0,255,0.9)"
          strokeWidth="1.2"
        />

        {/* Top face highlight */}
        <path
          d={`M ${cx} ${topY + 4} L ${cx + halfW * 0.92} ${topY + (midY - topY) * 0.65 + 1} L ${cx} ${midY - 3} L ${cx - halfW * 0.92} ${topY + (midY - topY) * 0.65 + 1} Z`}
          fill="none"
          stroke="rgba(255,255,255,0.55)"
          strokeWidth="0.8"
        />

        {/* Inner shelves */}
        <g opacity="0.4">
          {[0.35, 0.55, 0.75].map((t, i) => {
            const yL = topY + (midY - topY) * 0.65 + (botY - (botY - midY) * 0.35 - (topY + (midY - topY) * 0.65)) * t;
            return (
              <g key={i}>
                <line x1={cx - halfW + 2} y1={yL} x2={cx} y2={yL + (botY - midY) * t * 0.4 + (midY - topY) * (1 - t) * 0.05} stroke="rgba(132,41,255,0.4)" strokeWidth="0.6" />
                <line x1={cx + halfW - 2} y1={yL} x2={cx} y2={yL + (botY - midY) * t * 0.4 + (midY - topY) * (1 - t) * 0.05} stroke="rgba(132,41,255,0.4)" strokeWidth="0.6" />
              </g>
            );
          })}
        </g>

        {/* Glyph on top face */}
        {label && (
          <g transform={`translate(${cx}, ${topY + (midY - topY) * 0.45})`}>
            {label}
          </g>
        )}
      </svg>
    </div>
  );
};

// A simpler open-frame cube (wireframe style, like the "5 Key Things" reference)
const WireCube = ({ size = 280, style = {} }) => {
  const w = size;
  const h = size * 1.05;
  const cx = w / 2;
  const topY = h * 0.18;
  const midY = h * 0.5;
  const botY = h * 0.82;
  const halfW = w * 0.42;
  const id = React.useId().replace(/:/g, '');

  return (
    <div style={{ position: 'relative', width: w, height: h, ...style }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
        <defs>
          <radialGradient id={`wglow-${id}`} cx="0.5" cy="0.5" r="0.55">
            <stop offset="0%" stopColor="rgba(163,127,255,0.55)" />
            <stop offset="60%" stopColor="rgba(163,127,255,0.0)" />
          </radialGradient>
        </defs>
        <ellipse cx={cx} cy={midY + 10} rx={halfW * 0.9} ry={halfW * 0.55} fill={`url(#wglow-${id})`} />

        {/* Edges */}
        <g fill="none" stroke="rgba(132,41,255,0.7)" strokeWidth="1.2">
          {/* Top diamond */}
          <path d={`M ${cx} ${topY} L ${cx + halfW} ${topY + (midY - topY) * 0.65} L ${cx} ${midY} L ${cx - halfW} ${topY + (midY - topY) * 0.65} Z`} />
          {/* Bottom diamond */}
          <path d={`M ${cx} ${botY - (botY - midY)} L ${cx + halfW} ${botY - (botY - midY) * 0.35} L ${cx} ${botY} L ${cx - halfW} ${botY - (botY - midY) * 0.35} Z`} opacity="0.35" />
          {/* Verticals */}
          <line x1={cx} y1={midY} x2={cx} y2={botY} />
          <line x1={cx + halfW} y1={topY + (midY - topY) * 0.65} x2={cx + halfW} y2={botY - (botY - midY) * 0.35} />
          <line x1={cx - halfW} y1={topY + (midY - topY) * 0.65} x2={cx - halfW} y2={botY - (botY - midY) * 0.35} />

          {/* Inner shelves */}
          {[0.33, 0.66].map((t, i) => {
            const yT = topY + (midY - topY) * 0.65 + ((botY - (botY - midY) * 0.35) - (topY + (midY - topY) * 0.65)) * t;
            const yC = midY + (botY - midY) * t;
            return (
              <g key={i} opacity="0.5">
                <path d={`M ${cx - halfW} ${yT} L ${cx} ${yC} L ${cx + halfW} ${yT}`} />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};

// Stacked / clustered cubes (like the Tesseract banner)
const CubeCluster = ({ size = 360, style = {} }) => {
  const s = size * 0.55;
  return (
    <div style={{ position: 'relative', width: size, height: size, ...style }}>
      <div style={{ position: 'absolute', top: 0, left: '50%', transform: 'translateX(-50%)' }}>
        <IsoCube size={s} floor={false} />
      </div>
      <div style={{ position: 'absolute', bottom: 0, left: 0 }}>
        <IsoCube size={s} floor={false} />
      </div>
      <div style={{ position: 'absolute', bottom: 0, right: 0 }}>
        <IsoCube size={s} floor={false} />
      </div>
    </div>
  );
};

// Two-tier vault (like the OISY post)
const StackedVault = ({ size = 320, style = {} }) => {
  const s = size;
  return (
    <div style={{ position: 'relative', width: s, height: s * 1.4, ...style }}>
      <div style={{ position: 'absolute', top: 0, left: 0 }}>
        <IsoCube size={s} floor={false} />
      </div>
      <div style={{ position: 'absolute', top: s * 0.45, left: 0 }}>
        <IsoCube size={s} floor={true} />
      </div>
    </div>
  );
};

// Fusion logo mark — exact path from brand SVG
const FusionMark = ({ size = 32, color = '#8429FF' }) => (
  <svg width={size} height={size} viewBox="0 0 73 73" fill="none">
    <path fillRule="evenodd" clipRule="evenodd" d="M72.9745 36.4854C72.9745 28.9218 65.2566 22.5 53.6982 19.2763C50.4708 7.71785 44.0491 0 36.4854 0C28.9218 0 22.5 7.71785 19.2763 19.2763C7.71785 22.5037 0 28.9254 0 36.4854C0 44.0454 7.71785 50.4708 19.2763 53.6982C22.5037 65.2566 28.9254 72.9745 36.4854 72.9745C44.0454 72.9745 50.4708 65.2566 53.6982 53.6982C65.2566 50.4708 72.9745 44.0491 72.9745 36.4854ZM26.8656 13.6513C29.5533 8.24658 33.0597 5.14769 36.4744 5.14769C39.889 5.14769 43.4065 8.24658 46.0832 13.6513C46.7734 15.0575 47.3756 16.5042 47.8859 17.9875C40.3223 16.7318 32.6008 16.7318 25.0371 17.9875C25.5475 16.5042 26.1643 15.0759 26.8546 13.6696L26.8656 13.6513ZM50.7792 36.5038C50.7829 39.8156 50.5112 43.1054 50.0008 46.3769L26.5939 22.9553C29.8654 22.4449 33.1736 22.1916 36.4854 22.1989C40.84 22.1842 45.1836 22.6285 49.4464 23.5281C50.346 27.7909 50.7902 32.0978 50.7756 36.4524M22.1953 36.4634C22.1916 33.1515 22.4486 29.8691 22.9553 26.5939L46.3769 50.0192C43.1054 50.5296 39.7973 50.7829 36.4854 50.7756C32.1308 50.7902 27.7872 50.3423 23.5244 49.4464C22.6248 45.1836 22.1806 40.84 22.1953 36.4854V36.4634ZM13.6549 46.0942C8.25025 43.4065 5.15136 39.9001 5.15136 36.4854C5.15136 33.0708 8.25392 29.5533 13.6549 26.8766C15.0612 26.1864 16.5078 25.5842 17.9912 25.0739C16.7355 32.6375 16.7355 40.359 17.9912 47.9227C16.5078 47.4123 15.0832 46.7991 13.677 46.1052L13.6549 46.0942ZM46.1162 59.3342C43.4285 64.7389 39.9221 67.8378 36.5074 67.8378C33.0928 67.8378 29.5753 64.7353 26.8987 59.3342C26.2084 57.928 25.6062 56.4813 25.0959 54.998C28.8704 55.6295 32.6889 55.9453 36.5185 55.9379C40.3443 55.9453 44.1665 55.6295 47.941 54.998C47.4307 56.4813 46.8212 57.9096 46.1309 59.3159L46.1199 59.3342H46.1162ZM59.3379 46.1089C57.9316 46.7991 56.4924 47.416 55.009 47.9227C55.6442 44.1482 55.9563 40.3297 55.9489 36.5001C55.9563 32.6742 55.6405 28.852 55.009 25.0775C56.4924 25.5842 57.939 26.1864 59.3452 26.8803C64.7499 29.568 67.8488 33.0744 67.8488 36.4891C67.8488 39.9037 64.7499 43.4212 59.3452 46.0978H59.3379V46.1089Z" fill={color} />
  </svg>
);

const FusionLogo = ({ scale = 1, color = '#0B0E14', mark = '#8429FF', subColor }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 * scale }}>
    <FusionMark size={34 * scale} color={mark} />
    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
      <span style={{ fontSize: 26 * scale, fontWeight: 600, letterSpacing: '-0.025em', color }}>Fusion</span>
      <span style={{ fontSize: 11 * scale, fontWeight: 500, color: subColor || 'rgba(11,14,20,0.55)', letterSpacing: '0.04em', marginTop: 3 * scale }}>by IPOR</span>
    </div>
  </div>
);

Object.assign(window, { IsoCube, WireCube, CubeCluster, StackedVault, FusionMark, FusionLogo });
