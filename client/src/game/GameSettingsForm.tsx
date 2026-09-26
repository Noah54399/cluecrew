import {
  MODES,
  MODE_IDS,
  SCORING_RULES,
  SETTINGS_LIMITS,
  type GameSettings,
  type ModeAvailability,
  type ScoringMode,
} from '@shared';
import { Badge, Stepper, Toggle } from '../components/ui';
import { CheckIcon } from '../components/Icons';
import { ModeIconFor } from './modeVisuals';
import { modeAccentGradient } from '../lib/format';

export function GameSettingsForm({
  settings,
  availability,
  onChange,
  disabled = false,
}: {
  settings: GameSettings;
  availability: ModeAvailability[];
  onChange: (patch: Partial<GameSettings>) => void;
  disabled?: boolean;
}) {
  const unlimited = settings.roundCount === 0;

  return (
    <div className="settings-grid">
      <div className="setting-row">
        <div>
          <div className="setting-label">Rounds</div>
          <div className="setting-desc">
            Play exactly as many rounds as you like — or unlimited until you stop. No limits, ever.
          </div>
        </div>
        <div className="row wrap">
          {!unlimited && (
            <Stepper
              value={settings.roundCount}
              min={SETTINGS_LIMITS.roundCount.min}
              max={SETTINGS_LIMITS.roundCount.max}
              disabled={disabled}
              onChange={(roundCount) => onChange({ roundCount })}
            />
          )}
          <Toggle
            checked={unlimited}
            disabled={disabled}
            onChange={(checked) => onChange({ roundCount: checked ? 0 : 10 })}
            title="Unlimited"
            description="Play until the host ends the game"
          />
        </div>
      </div>

      <div className="setting-row">
        <div>
          <div className="setting-label">Timer per question</div>
          <div className="setting-desc">Seconds to guess before answers lock in.</div>
        </div>
        <Stepper
          value={settings.secondsPerRound}
          min={SETTINGS_LIMITS.secondsPerRound.min}
          max={SETTINGS_LIMITS.secondsPerRound.max}
          step={5}
          disabled={disabled}
          format={(value) => `${value}s`}
          onChange={(secondsPerRound) => onChange({ secondsPerRound })}
        />
      </div>

      <div>
        <div className="setting-label">Game modes</div>
        <div className="setting-desc" style={{ maxWidth: 'none' }}>
          Modes labelled <strong>Demo data</strong> are playable immediately with clearly-labelled demo
          content. <strong>TikTok API</strong> modes use real data from connected accounts. Unavailable
          modes need permissions TikTok does not grant consumer apps — they are never faked.
        </div>
        <div className="mode-toggle-list">
          {MODE_IDS.map((modeId) => {
            const mode = MODES[modeId];
            const entry = availability.find((item) => item.mode === modeId);
            const playable = entry?.playable ?? false;
            const enabled = settings.enabledModes.includes(modeId);
            return (
              <label
                key={modeId}
                className={`mode-toggle ${enabled ? 'enabled' : ''} ${playable ? '' : 'unavailable'}`}
              >
                <input
                  type="checkbox"
                  className="visually-hidden"
                  checked={enabled}
                  disabled={disabled || !playable}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...settings.enabledModes, modeId]
                      : settings.enabledModes.filter((item) => item !== modeId);
                    if (next.length > 0) onChange({ enabledModes: next });
                  }}
                />
                <span
                  className="mode-row-icon"
                  style={{ background: modeAccentGradient(mode.accent) }}
                  aria-hidden
                >
                  <ModeIconFor mode={modeId} size={18} />
                </span>
                <span className="mode-toggle-body">
                  <span className="mode-toggle-title">
                    {mode.title}
                    {!playable && <Badge variant="danger">Unavailable</Badge>}
                    {playable && entry?.sources.includes('official_api') && (
                      <Badge variant="mint">TikTok API</Badge>
                    )}
                    {playable && entry?.sources.includes('mock') && (
                      <Badge variant="amber">Demo data</Badge>
                    )}
                  </span>
                  <span className="mode-toggle-note">{entry?.reason ?? mode.description}</span>
                </span>
                <span
                  aria-hidden
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 9,
                    border: '1px solid var(--border-strong)',
                    display: 'grid',
                    placeItems: 'center',
                    background: enabled ? 'var(--primary)' : 'transparent',
                    color: '#fff',
                    flex: 'none',
                    marginTop: 2,
                  }}
                >
                  {enabled && <CheckIcon size={15} />}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <Toggle
        checked={settings.randomMix}
        disabled={disabled}
        onChange={(randomMix) => onChange({ randomMix })}
        title="Random mix"
        description="Mix all enabled modes in a random order instead of cycling through them."
      />

      <div>
        <div className="setting-label">Scoring</div>
        <div className="scoring-options">
          {(Object.keys(SCORING_RULES) as ScoringMode[]).map((scoringMode) => (
            <button
              key={scoringMode}
              type="button"
              disabled={disabled}
              className={`scoring-option ${settings.scoringMode === scoringMode ? 'selected' : ''}`}
              onClick={() => onChange({ scoringMode })}
            >
              <strong>{SCORING_RULES[scoringMode].label}</strong>
              <div className="faint small" style={{ marginTop: 3 }}>
                {SCORING_RULES[scoringMode].description}
              </div>
            </button>
          ))}
        </div>
      </div>

      <Toggle
        checked={settings.randomizeOrder}
        disabled={disabled}
        onChange={(randomizeOrder) => onChange({ randomizeOrder })}
        title="Randomised player order"
        description="Shuffle the guess options every round."
      />

      <Toggle
        checked={settings.showAvatars}
        disabled={disabled}
        onChange={(showAvatars) => onChange({ showAvatars })}
        title="Show player avatars"
        description="Hide avatars during guessing for a harder challenge."
      />
    </div>
  );
}
