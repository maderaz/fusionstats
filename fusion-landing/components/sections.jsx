// Landing page sections.

const Container = ({ children, style = {}, narrow = false }) => (
  <div style={{
    maxWidth: narrow ? 1080 : 1280,
    margin: '0 auto',
    padding: '0 32px',
    width: '100%',
    ...style,
  }}>{children}</div>
);

const Pill = ({ children, color = 'var(--purple)' }) => (
  <span className="mono" style={{
    display: 'inline-block',
    fontSize: 11,
    color,
    background: 'rgba(132,41,255,0.08)',
    border: '1px solid rgba(132,41,255,0.18)',
    padding: '6px 12px',
    borderRadius: 999,
  }}>{children}</span>
);

const Btn = ({ children, primary = false, style = {}, ...rest }) => (
  <button {...rest} style={{
    padding: '13px 22px',
    borderRadius: 10,
    fontSize: 15,
    fontWeight: 500,
    letterSpacing: '-0.005em',
    transition: 'all 0.18s ease',
    background: primary ? 'var(--ink)' : 'transparent',
    color: primary ? '#fff' : 'var(--ink)',
    border: primary ? '1px solid var(--ink)' : '1px solid var(--line)',
    ...style,
  }}>{children}</button>
);

// ============================================================
// NAV
// ============================================================
const Nav = () => (
  <header style={{
    position: 'sticky', top: 0, zIndex: 50,
    background: 'rgba(251,250,254,0.78)',
    backdropFilter: 'blur(14px)',
    borderBottom: '1px solid var(--line-soft)',
  }}>
    <Container style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 72 }}>
      <FusionLogo scale={0.85} />
      <nav style={{ display: 'flex', gap: 36, fontSize: 14, color: 'var(--body)', fontWeight: 500 }}>
        <a href="#vaults">Vaults</a>
        <a href="#partners">Partners</a>
        <a href="#research">Research</a>
        <a href="#docs">Docs</a>
        <a href="#dao">DAO</a>
      </nav>
      <div style={{ display: 'flex', gap: 10 }}>
        <Btn>Launch app</Btn>
        <Btn primary>Build a vault →</Btn>
      </div>
    </Container>
  </header>
);

// ============================================================
// HERO
// ============================================================
const Hero = ({ accent }) => {
  return (
    <section style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Background gradient wash */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 1100px 600px at 75% 30%, rgba(163,127,255,0.28), transparent 65%), radial-gradient(ellipse 600px 400px at 15% 80%, rgba(132,41,255,0.10), transparent 70%)',
        pointerEvents: 'none',
      }} />
      {/* Iso grid floor right side */}
      <div style={{ position: 'absolute', right: 0, bottom: 0, width: '55%', height: '100%', pointerEvents: 'none', opacity: 0.5 }}>
        <svg width="100%" height="100%" viewBox="0 0 800 700" preserveAspectRatio="xMidYMid slice">
          <defs>
            <linearGradient id="floorMask" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(132,41,255,0)" />
              <stop offset="60%" stopColor="rgba(132,41,255,0.18)" />
              <stop offset="100%" stopColor="rgba(132,41,255,0)" />
            </linearGradient>
          </defs>
          {Array.from({ length: 30 }).map((_, i) => {
            const o = i * 35;
            return <g key={i}>
              <line x1={-100 + o * 1.7} y1={350} x2={400 + o * 1.7} y2={600} stroke="url(#floorMask)" strokeWidth="0.5" />
              <line x1={400 + o * 1.7} y1={100} x2={-100 + o * 1.7} y2={350} stroke="url(#floorMask)" strokeWidth="0.5" />
            </g>;
          })}
        </svg>
      </div>

      <Container style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 60, alignItems: 'center', padding: '100px 32px 120px' }}>
        <div>
          <Pill>Fusion · Onchain Vault Infrastructure</Pill>
          <h1 style={{
            fontSize: 76, lineHeight: 1.02, fontWeight: 600, letterSpacing: '-0.035em',
            margin: '24px 0 22px', textWrap: 'balance',
          }}>
            <span style={{ color: accent }}>Programmable vaults</span> for the next generation of onchain capital.
          </h1>
          <p style={{ fontSize: 19, lineHeight: 1.55, color: 'var(--body)', maxWidth: 560, margin: '0 0 36px', textWrap: 'pretty' }}>
            Fusion is the institutional vault layer behind IPOR — a permissionless framework for routing yield across DeFi, RWAs, and structured strategies, with the controls treasuries actually need.
          </p>
          <div style={{ display: 'flex', gap: 12, marginBottom: 44 }}>
            <Btn primary style={{ fontSize: 15.5 }}>Launch the app →</Btn>
            <Btn>Read the docs</Btn>
          </div>
          <div style={{ display: 'flex', gap: 40, paddingTop: 28, borderTop: '1px solid var(--line)' }}>
            {[
              ['$1.4B', 'Routed onchain'],
              ['38', 'Active vaults'],
              ['12', 'Integrated chains'],
            ].map(([n, l]) => (
              <div key={l}>
                <div style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>{n}</div>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ position: 'relative', height: 540, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Beaker-style framing nodded at: a rounded glow around the cube */}
          <div style={{
            position: 'absolute', width: 460, height: 460,
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(255,255,255,0.7) 0%, rgba(163,127,255,0.15) 60%, transparent 78%)',
          }} />
          <IsoCube size={400} />
          {/* Floating tags */}
          <div style={{ position: 'absolute', top: '12%', left: '-2%', background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 12px 30px rgba(132,41,255,0.10)' }}>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>STRATEGY</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>Aave v3 → Pendle PT</div>
          </div>
          <div style={{ position: 'absolute', bottom: '14%', right: '-1%', background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 12px 30px rgba(132,41,255,0.10)' }}>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>APY · 30D</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, color: accent }}>9.42%</div>
          </div>
          <div style={{ position: 'absolute', top: '46%', right: '4%', background: '#fff', border: '1px solid var(--line)', borderRadius: 12, padding: '10px 14px', boxShadow: '0 12px 30px rgba(132,41,255,0.10)' }}>
            <div className="mono" style={{ fontSize: 9.5, color: 'var(--muted)' }}>RISK · GUARDIAN</div>
            <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>Steakhouse Fin.</div>
          </div>
        </div>
      </Container>
    </section>
  );
};

// ============================================================
// LOGO STRIP — partners
// ============================================================
const PartnerStrip = () => {
  const partners = ['TESSERACT', '21SHARES', 'OISY', 'STEAKHOUSE', 'GAUNTLET', 'PENDLE', 'MORPHO'];
  return (
    <section style={{ borderTop: '1px solid var(--line-soft)', borderBottom: '1px solid var(--line-soft)', background: '#fff' }}>
      <Container style={{ padding: '32px 32px', display: 'flex', alignItems: 'center', gap: 40, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>Trusted by · institutional partners</div>
        <div style={{ display: 'flex', gap: 48, alignItems: 'center', flexWrap: 'wrap' }}>
          {partners.map(p => (
            <div key={p} style={{
              fontSize: 15, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--ink-2)', opacity: 0.6,
              fontFamily: 'Inter Tight, sans-serif',
            }}>{p}</div>
          ))}
        </div>
      </Container>
    </section>
  );
};

// ============================================================
// WHAT IS FUSION — feature triplet
// ============================================================
const FeatureGrid = ({ accent }) => {
  const features = [
    {
      tag: '01 / Compose',
      title: 'Stack any onchain strategy',
      body: 'Route deposits across lending markets, RWA tokens, perps funding, and structured products — within a single vault, governed by a single guardian.',
      icon: <IsoCube size={130} floor={false} />,
    },
    {
      tag: '02 / Control',
      title: 'Institutional-grade guardrails',
      body: 'Whitelisted strategies, asset caps, withdrawal queues, and time-delayed updates. Built so risk teams stay in the loop, not out of it.',
      icon: <WireCube size={130} />,
    },
    {
      tag: '03 / Distribute',
      title: 'One vault, many surfaces',
      body: 'Plug Fusion into wallets, neobanks, or your own front-end. Same accounting, same yield, your branding — your users never leave.',
      icon: <CubeCluster size={150} />,
    },
  ];

  return (
    <section style={{ padding: '120px 0', background: 'var(--bg)' }}>
      <Container>
        <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.2fr', gap: 80, marginBottom: 72, alignItems: 'end' }}>
          <div>
            <Pill>What Fusion does</Pill>
            <h2 style={{ fontSize: 56, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.03em', margin: '20px 0 0', textWrap: 'balance' }}>
              The vault layer for <span style={{ color: accent }}>capital that has to answer to someone.</span>
            </h2>
          </div>
          <p style={{ fontSize: 18, lineHeight: 1.55, color: 'var(--body)', textWrap: 'pretty', maxWidth: 520, justifySelf: 'end' }}>
            Most onchain vaults pick one strategy and pray. Fusion is built around the assumption that real allocators rotate, hedge, and answer to risk committees. Every primitive in the protocol exists for that reason.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {features.map((f, i) => (
            <div key={i} style={{
              background: '#fff',
              border: '1px solid var(--line)',
              borderRadius: 20,
              padding: '32px 28px 36px',
              position: 'relative',
              overflow: 'hidden',
            }}>
              <div style={{ position: 'absolute', top: -10, right: -30, opacity: 0.95 }}>
                {f.icon}
              </div>
              <div className="mono" style={{ fontSize: 11, color: accent, marginBottom: 180 }}>{f.tag}</div>
              <h3 style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 12px', textWrap: 'balance', maxWidth: '85%' }}>{f.title}</h3>
              <p style={{ fontSize: 15, lineHeight: 1.55, color: 'var(--body)', margin: 0, textWrap: 'pretty' }}>{f.body}</p>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
};

// ============================================================
// VAULT TABLE
// ============================================================
const VaultsTable = ({ accent }) => {
  const vaults = [
    { name: 'Fusion USDC Conservative', curator: 'Steakhouse Financial', tvl: '$284.2M', apy: '7.84%', strategies: 4, asset: 'USDC' },
    { name: 'Fusion USDC Yield+', curator: 'Gauntlet', tvl: '$162.0M', apy: '11.20%', strategies: 7, asset: 'USDC' },
    { name: 'Fusion ETH LST Composite', curator: 'Re7 Labs', tvl: '$98.4M', apy: '5.62%', strategies: 5, asset: 'wETH' },
    { name: 'Fusion RWA Treasuries', curator: 'IPOR DAO', tvl: '$71.9M', apy: '4.95%', strategies: 3, asset: 'USDC' },
    { name: 'Fusion sUSDe Carry', curator: 'BlockAnalitica', tvl: '$54.1M', apy: '14.38%', strategies: 4, asset: 'sUSDe' },
  ];
  return (
    <section id="vaults" style={{ padding: '110px 0', background: 'var(--bg-alt)' }}>
      <Container>
        <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', marginBottom: 44, gap: 40 }}>
          <div>
            <Pill>Live vaults</Pill>
            <h2 style={{ fontSize: 52, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.03em', margin: '20px 0 0', textWrap: 'balance' }}>
              A curated <span style={{ color: accent }}>fleet of strategies</span>, not a marketplace of tokens.
            </h2>
          </div>
          <Btn>Browse all vaults →</Btn>
        </div>

        <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr 1fr', padding: '16px 28px', borderBottom: '1px solid var(--line)', fontSize: 11, color: 'var(--muted)' }} className="mono">
            <div>Vault</div>
            <div>Curator</div>
            <div>Asset</div>
            <div style={{ textAlign: 'right' }}>TVL</div>
            <div style={{ textAlign: 'right' }}>30D APY</div>
            <div style={{ textAlign: 'right' }}>Strategies</div>
          </div>
          {vaults.map((v, i) => (
            <div key={v.name} style={{
              display: 'grid', gridTemplateColumns: '2.5fr 1.5fr 1fr 1fr 1fr 1fr',
              padding: '20px 28px',
              borderBottom: i < vaults.length - 1 ? '1px solid var(--line-soft)' : 'none',
              alignItems: 'center', fontSize: 15,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 36, height: 36, borderRadius: 8, background: `linear-gradient(135deg, ${accent}, var(--purple-deep))`, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.6), transparent 60%)' }} />
                </div>
                <div style={{ fontWeight: 500, letterSpacing: '-0.01em' }}>{v.name}</div>
              </div>
              <div style={{ color: 'var(--body)' }}>{v.curator}</div>
              <div className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{v.asset}</div>
              <div style={{ textAlign: 'right', fontWeight: 500 }}>{v.tvl}</div>
              <div style={{ textAlign: 'right', fontWeight: 600, color: accent }}>{v.apy}</div>
              <div style={{ textAlign: 'right', color: 'var(--body)' }}>{v.strategies}</div>
            </div>
          ))}
        </div>
      </Container>
    </section>
  );
};

// ============================================================
// PARTNER SPOTLIGHT — split with stacked vault
// ============================================================
const PartnerSpotlight = ({ accent }) => (
  <section id="partners" style={{ padding: '120px 0', background: '#fff', borderTop: '1px solid var(--line-soft)', borderBottom: '1px solid var(--line-soft)' }}>
    <Container>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 80, alignItems: 'center' }}>
        <div style={{ position: 'relative', height: 520, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'absolute', width: 420, height: 420, borderRadius: '50%', background: 'radial-gradient(circle, rgba(163,127,255,0.18), transparent 70%)' }} />
          <StackedVault size={280} />
        </div>
        <div>
          <Pill>Partner spotlight</Pill>
          <h2 style={{ fontSize: 48, lineHeight: 1.08, fontWeight: 600, letterSpacing: '-0.025em', margin: '20px 0 24px', textWrap: 'balance' }}>
            <span style={{ color: accent }}>Tesseract</span> selected Fusion for institutional vault infrastructure — with 21Shares among pilot partners.
          </h2>
          <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--body)', margin: '0 0 28px', textWrap: 'pretty' }}>
            Fusion vaults already power the OISY Earn Program and back custody flows at multiple regulated venues. Same accounting layer, custom risk policy, distinct front-ends.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderTop: '1px solid var(--line)' }}>
            {[
              ['Accounting', 'ERC-4626 base'],
              ['Settlement', 'Per-block, atomic'],
              ['Custody', 'Self / Fireblocks / Copper'],
              ['Reporting', 'On-chain + signed CSV'],
            ].map(([k, v], i) => (
              <div key={k} style={{ padding: '18px 0', borderBottom: i < 2 ? '1px solid var(--line)' : 'none', paddingRight: 24 }}>
                <div className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{k}</div>
                <div style={{ fontSize: 16, fontWeight: 500, marginTop: 4 }}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Container>
  </section>
);

// ============================================================
// RESEARCH / CONTENT GRID
// ============================================================
const Research = ({ accent }) => {
  const items = [
    {
      tag: 'IPOR Labs Research',
      title: 'Pricing Liquidity on Real World Assets in DeFi',
      kind: 'Paper',
      time: '14 min read',
    },
    {
      tag: 'Note',
      title: '5 Key Things Institutions Need From Onchain Vaults',
      kind: 'Article',
      time: '6 min read',
    },
    {
      tag: 'Announcement',
      title: 'Fusion Vaults Now Underpin the OISY Earn Program',
      kind: 'News',
      time: '3 min read',
    },
  ];
  return (
    <section id="research" style={{ padding: '120px 0', background: 'var(--bg)' }}>
      <Container>
        <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', marginBottom: 44 }}>
          <div>
            <Pill>From the lab</Pill>
            <h2 style={{ fontSize: 48, lineHeight: 1.05, fontWeight: 600, letterSpacing: '-0.03em', margin: '20px 0 0', textWrap: 'balance', maxWidth: 720 }}>
              Research, not <span style={{ color: accent }}>thought leadership.</span>
            </h2>
          </div>
          <Btn>All writing →</Btn>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 24 }}>
          {items.map((it, i) => (
            <a key={i} style={{ display: 'block', cursor: 'pointer' }}>
              <div style={{
                background: '#fff', border: '1px solid var(--line)',
                borderRadius: 18, overflow: 'hidden',
              }}>
                {/* Banner area */}
                <div style={{
                  height: 200, position: 'relative', overflow: 'hidden',
                  background: i === 0
                    ? 'linear-gradient(135deg, #F5F3FB 0%, #EFE6FF 100%)'
                    : i === 1
                      ? 'linear-gradient(135deg, #FBFAFE 0%, #E5DCFF 100%)'
                      : 'linear-gradient(135deg, #F2EBFF 0%, #FFFFFF 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  {i === 0 && (
                    <div style={{ position: 'relative' }}>
                      {/* Beaker shape with cube inside */}
                      <svg width="170" height="180" viewBox="0 0 170 180" fill="none">
                        <path d="M 70 20 L 70 60 L 30 140 Q 25 165 55 165 L 115 165 Q 145 165 140 140 L 100 60 L 100 20 Z" stroke="rgba(132,41,255,0.6)" strokeWidth="1.5" fill="rgba(163,127,255,0.18)" />
                        <line x1="65" y1="20" x2="105" y2="20" stroke="rgba(132,41,255,0.7)" strokeWidth="2" />
                      </svg>
                      <div style={{ position: 'absolute', top: '52%', left: '50%', transform: 'translate(-50%, -50%)' }}>
                        <WireCube size={70} />
                      </div>
                    </div>
                  )}
                  {i === 1 && <WireCube size={140} />}
                  {i === 2 && <IsoCube size={150} floor={false} />}
                </div>
                <div style={{ padding: '24px 24px 26px' }}>
                  <div className="mono" style={{ fontSize: 10.5, color: accent, marginBottom: 12 }}>{it.tag}</div>
                  <h3 style={{ fontSize: 20, lineHeight: 1.25, fontWeight: 600, letterSpacing: '-0.015em', margin: '0 0 16px', textWrap: 'balance' }}>{it.title}</h3>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted)' }}>
                    <span>{it.kind}</span>
                    <span>{it.time}</span>
                  </div>
                </div>
              </div>
            </a>
          ))}
        </div>
      </Container>
    </section>
  );
};

// ============================================================
// CTA
// ============================================================
const CTA = ({ accent }) => (
  <section style={{ padding: '40px 32px 100px' }}>
    <div style={{
      maxWidth: 1280, margin: '0 auto',
      borderRadius: 28,
      background: 'linear-gradient(135deg, #FBFAFE 0%, #EFE6FF 50%, #DCC9FF 100%)',
      padding: '80px 80px',
      position: 'relative', overflow: 'hidden',
      border: '1px solid rgba(132,41,255,0.18)',
    }}>
      {/* Iso grid floor */}
      <div style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none' }}>
        <svg width="100%" height="100%" viewBox="0 0 1200 400" preserveAspectRatio="none">
          {Array.from({ length: 40 }).map((_, i) => {
            const o = i * 40;
            return <g key={i}>
              <line x1={-200 + o * 1.5} y1={250} x2={500 + o * 1.5} y2={500} stroke="rgba(132,41,255,0.18)" strokeWidth="0.5" />
              <line x1={500 + o * 1.5} y1={-50} x2={-200 + o * 1.5} y2={250} stroke="rgba(132,41,255,0.18)" strokeWidth="0.5" />
            </g>;
          })}
        </svg>
      </div>
      <div style={{ position: 'absolute', right: 60, top: '50%', transform: 'translateY(-50%)' }}>
        <CubeCluster size={300} />
      </div>
      <div style={{ position: 'relative', maxWidth: 620 }}>
        <Pill>Build with Fusion</Pill>
        <h2 style={{ fontSize: 60, lineHeight: 1.02, fontWeight: 600, letterSpacing: '-0.035em', margin: '24px 0 22px', textWrap: 'balance' }}>
          Ship a vault in <span style={{ color: accent }}>an afternoon</span>, not a quarter.
        </h2>
        <p style={{ fontSize: 18, lineHeight: 1.55, color: 'var(--body)', margin: '0 0 32px', textWrap: 'pretty' }}>
          Fork a strategy template, define a risk policy, and route real volume through it the same day. Vault SDK in TypeScript, Solidity, and Rust.
        </p>
        <div style={{ display: 'flex', gap: 12 }}>
          <Btn primary>Launch the app →</Btn>
          <Btn>Book a call</Btn>
        </div>
      </div>
    </div>
  </section>
);

// ============================================================
// FOOTER
// ============================================================
const Footer = () => (
  <footer style={{ background: 'var(--ink)', color: 'rgba(255,255,255,0.7)', padding: '80px 32px 36px' }}>
    <div style={{ maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr 1fr 1fr 1fr', gap: 40, paddingBottom: 60, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
        <div>
          <FusionLogo scale={0.95} color="#fff" mark="#A37FFF" subColor="rgba(255,255,255,0.55)" />
          <p style={{ marginTop: 22, fontSize: 14, lineHeight: 1.6, maxWidth: 320, color: 'rgba(255,255,255,0.55)' }}>
            Onchain vault infrastructure built and maintained by IPOR Labs. Permissionless, audited, governed by the IPOR DAO.
          </p>
        </div>
        {[
          ['Product', ['Vaults', 'Curators', 'SDK', 'Audits', 'Bug bounty']],
          ['Build', ['Docs', 'Quickstart', 'API', 'Risk policies', 'Examples']],
          ['Resources', ['Research', 'Blog', 'Brand', 'Press', 'Status']],
          ['Company', ['About', 'IPOR DAO', 'Careers', 'Contact', 'Terms']],
        ].map(([h, items]) => (
          <div key={h}>
            <div className="mono" style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.45)', marginBottom: 14 }}>{h}</div>
            {items.map(it => (
              <div key={it} style={{ fontSize: 14, color: 'rgba(255,255,255,0.78)', marginBottom: 10 }}>{it}</div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 28, fontSize: 12.5, color: 'rgba(255,255,255,0.45)' }}>
        <div>© 2026 IPOR Labs · Fusion is a permissionless protocol. Past performance is not indicative of future returns.</div>
        <div style={{ display: 'flex', gap: 24 }}>
          <span>Twitter / X</span>
          <span>GitHub</span>
          <span>Discord</span>
          <span>Mirror</span>
        </div>
      </div>
    </div>
  </footer>
);

Object.assign(window, { Nav, Hero, PartnerStrip, FeatureGrid, VaultsTable, PartnerSpotlight, Research, CTA, Footer });
