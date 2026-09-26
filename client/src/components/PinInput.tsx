import { useEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH, normalizeRoomCode } from '@shared';

/**
 * Six-box code input with paste support, auto-advance and keyboard navigation.
 */
export function PinInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState<number | null>(null);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
  const chars = Array.from({ length: ROOM_CODE_LENGTH }, (_, index) => value[index] ?? '');

  useEffect(() => {
    if (autoFocus) inputsRef.current[0]?.focus();
  }, [autoFocus]);

  const setChar = (index: number, char: string) => {
    const next = chars.slice();
    next[index] = char;
    const joined = next.join('');
    onChange(joined);
    if (joined.length === ROOM_CODE_LENGTH && !joined.includes(' ')) {
      const normalized = normalizeRoomCode(joined);
      if (normalized && normalized.length === ROOM_CODE_LENGTH) onComplete?.(normalized);
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (chars[index]) {
        setChar(index, '');
      } else if (index > 0) {
        setChar(index - 1, '');
        inputsRef.current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      inputsRef.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < ROOM_CODE_LENGTH - 1) {
      event.preventDefault();
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const pasted = normalizeRoomCode(event.clipboardData.getData('text')) ?? '';
    const trimmed = pasted.slice(0, ROOM_CODE_LENGTH);
    if (!trimmed) return;
    onChange(trimmed);
    const focusIndex = Math.min(trimmed.length, ROOM_CODE_LENGTH - 1);
    inputsRef.current[focusIndex]?.focus();
    if (trimmed.length === ROOM_CODE_LENGTH) onComplete?.(trimmed);
  };

  return (
    <div className="pin-input">
      {chars.map((char, index) => (
        <input
          key={index}
          ref={(element) => {
            inputsRef.current[index] = element;
          }}
          value={char}
          disabled={disabled}
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label={`Character ${index + 1}`}
          className={char ? 'filled' : ''}
          onFocus={() => setFocused(index)}
          onBlur={() => setFocused(null)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onChange={(event) => {
            const raw = event.target.value.toUpperCase();
            const valid = [...raw].filter((c) => ROOM_CODE_ALPHABET.includes(c));
            if (valid.length === 0) {
              setChar(index, '');
              return;
            }
            if (valid.length > 1) {
              const merged = (value.slice(0, index) + valid.join('')).slice(0, ROOM_CODE_LENGTH);
              onChange(merged);
              const focusIndex = Math.min(index + valid.length, ROOM_CODE_LENGTH - 1);
              inputsRef.current[focusIndex]?.focus();
              if (merged.length === ROOM_CODE_LENGTH) onComplete?.(merged);
              return;
            }
            setChar(index, valid[0]!);
            if (index < ROOM_CODE_LENGTH - 1) inputsRef.current[index + 1]?.focus();
          }}
        />
      ))}
    </div>
  );
}
