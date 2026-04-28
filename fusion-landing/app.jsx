// Main app — wires sections together with the tweaks panel.

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accentHue": "purple",
  "headlineWeight": 600,
  "showPartnerStrip": true,
  "heroVariant": "cube"
}/*EDITMODE-END*/;

const ACCENT_MAP = {
  purple: '#8429FF',
  deep:   '#6C00FF',
  light:  '#A37FFF',
  blue:   '#006EF2',
};

function App() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const accent = ACCENT_MAP[tweaks.accentHue] || ACCENT_MAP.purple;

  // Inject accent override
  React.useEffect(() => {
    document.documentElement.style.setProperty('--accent-live', accent);
  }, [accent]);

  return (
    <div>
      <Nav />
      <Hero accent={accent} />
      {tweaks.showPartnerStrip && <PartnerStrip />}
      <FeatureGrid accent={accent} />
      <VaultsTable accent={accent} />
      <PartnerSpotlight accent={accent} />
      <Research accent={accent} />
      <CTA accent={accent} />
      <Footer />

      <TweaksPanel title="Tweaks">
        <TweakSection title="Accent">
          <TweakRadio
            label="Color"
            value={tweaks.accentHue}
            onChange={(v) => setTweak('accentHue', v)}
            options={[
              { value: 'purple', label: 'Purple' },
              { value: 'deep',   label: 'Deep' },
              { value: 'light',  label: 'Light' },
              { value: 'blue',   label: 'Blue' },
            ]}
          />
        </TweakSection>
        <TweakSection title="Layout">
          <TweakToggle
            label="Show partner logo strip"
            value={tweaks.showPartnerStrip}
            onChange={(v) => setTweak('showPartnerStrip', v)}
          />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
