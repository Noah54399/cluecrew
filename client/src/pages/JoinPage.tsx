import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { PublicRoomInfo } from '@shared';
import { roomsApi, ApiError, setCsrfToken } from '../lib/api';
import { getIdentity, saveIdentity, savePlayer } from '../lib/storage';
import { AvatarPicker } from '../components/Avatar';
import { Badge, Banner, Button, Card, Input } from '../components/ui';
import { PinInput } from '../components/PinInput';
import { Logo } from '../components/Logo';
import { ThemeToggle } from '../components/ThemeToggle';
import { InfoIcon, UsersIcon } from '../components/Icons';
import { useToast } from '../app/ToastProvider';

export function JoinPage() {
  const params = useParams<{ code?: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const [code, setCode] = useState(() => (params.code ?? '').toUpperCase().slice(0, 6));
  const [info, setInfo] = useState<PublicRoomInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [name, setName] = useState(() => getIdentity().name);
  const [avatarSeed, setAvatarSeed] = useState(() => getIdentity().avatarSeed);
  const [joining, setJoining] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const checkRoom = useCallback(
    async (value: string) => {
      setChecking(true);
      setInfoError(null);
      try {
        const roomInfo = await roomsApi.info(value);
        setInfo(roomInfo);
      } catch (error) {
        setInfo(null);
        setInfoError(error instanceof ApiError ? error.message : 'Could not find that room.');
      } finally {
        setChecking(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (code.length === 6) void checkRoom(code);
    else {
      setInfo(null);
      setInfoError(null);
    }
  }, [code, checkRoom]);

  const join = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError('Please enter a display name.');
      return;
    }
    if (trimmed.length > 24) {
      setNameError('Names can be at most 24 characters.');
      return;
    }
    setNameError(null);
    setJoining(true);
    try {
      const result = await roomsApi.join(code, trimmed, avatarSeed);
      setCsrfToken(result.csrfToken ?? null);
      savePlayer({
        code: result.code,
        playerId: result.playerId,
        playerToken: result.playerToken,
        name: trimmed,
        avatarSeed,
      });
      saveIdentity(trimmed, avatarSeed);
      navigate(`/room/${result.code}`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : 'Could not join the room.';
      toast.error(message);
      if (error instanceof ApiError && (error.code === 'ROOM_IN_GAME' || error.code === 'ROOM_FULL')) {
        void checkRoom(code);
      }
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="page">
      <nav className="topnav">
        <div className="container topnav-inner">
          <Logo />
          <ThemeToggle />
        </div>
      </nav>

      <main className="container container-narrow stack-lg" style={{ paddingTop: 26, paddingBottom: 60 }}>
        <div className="center stack-sm">
          <h1 style={{ fontSize: 'clamp(28px, 6vw, 38px)' }}>Enter game code</h1>
          <p className="muted">Ask the host for the 6-letter code shown in their lobby.</p>
        </div>

        <Card>
          <div className="stack">
            <PinInput
              value={code}
              onChange={(value) => setCode(value.toUpperCase())}
              onComplete={(value) => void checkRoom(value)}
              disabled={joining}
              autoFocus={!params.code}
            />
            {checking && <p className="center faint small">Checking the code…</p>}
            {infoError && <Banner kind="error">{infoError}</Banner>}
            {info && (
              <div className="stack-sm anim-fade-up">
                <div className="row-between">
                  <span className="row">
                    <UsersIcon size={17} />
                    <strong>{info.hostName ?? 'Host'}</strong>&apos;s room
                  </span>
                  <Badge variant={info.joinable ? 'success' : 'danger'}>
                    {info.playerCount} {info.playerCount === 1 ? 'player' : 'players'}
                  </Badge>
                </div>
                {info.joinable ? (
                  <p className="faint small">
                    {info.status === 'ended'
                      ? 'The last game finished — join for the next one!'
                      : 'You are in. Pick a name to join the lobby.'}
                  </p>
                ) : (
                  <Banner kind="warn" icon={<InfoIcon size={16} />}>
                    {info.joinableReason ?? 'This room is not accepting players right now.'}
                  </Banner>
                )}
              </div>
            )}
          </div>
        </Card>

        {info?.joinable && (
          <Card className="anim-fade-up" title="Your player" subtitle="No account needed — just a name.">
            <div className="stack">
              <div className="field">
                <label className="label" htmlFor="join-name">
                  Display name
                </label>
                <Input
                  id="join-name"
                  value={name}
                  maxLength={24}
                  placeholder="e.g. Nova"
                  className={nameError ? 'input-error' : ''}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void join();
                  }}
                />
                {nameError && <span className="input-hint" style={{ color: 'var(--danger)' }}>{nameError}</span>}
              </div>
              <div className="field">
                <span className="label">Pick your avatar</span>
                <AvatarPicker value={avatarSeed} name={name || '?'} onChange={setAvatarSeed} />
              </div>
              <Button
                variant="primary"
                size="lg"
                block
                loading={joining}
                onClick={() => void join()}
              >
                Join game
              </Button>
            </div>
          </Card>
        )}

        {!info?.joinable && (
          <p className="center faint small">
            No code yet? <Link to="/">Create your own game instead</Link>.
          </p>
        )}
      </main>
    </div>
  );
}
