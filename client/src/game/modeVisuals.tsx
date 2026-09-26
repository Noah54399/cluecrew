import { MODES, type ModeIcon, type ModeId } from '@shared';
import { BookmarkIcon, ClapperIcon, HeartIcon, RepeatIcon } from '../components/Icons';

export function ModeIconView({ icon, size = 20 }: { icon: ModeIcon; size?: number }) {
  switch (icon) {
    case 'heart':
      return <HeartIcon size={size} />;
    case 'repeat':
      return <RepeatIcon size={size} />;
    case 'bookmark':
      return <BookmarkIcon size={size} />;
    case 'clapper':
      return <ClapperIcon size={size} />;
  }
}

export function ModeIconFor({ mode, size = 20 }: { mode: ModeId; size?: number }) {
  return <ModeIconView icon={MODES[mode].icon} size={size} />;
}
