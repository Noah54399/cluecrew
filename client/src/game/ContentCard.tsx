import type { ContentView } from '@shared';
import { Badge } from '../components/ui';
import { LinkIcon } from '../components/Icons';
import { ModeIconFor } from './modeVisuals';

export function ContentCard({ content, revealed = false }: { content: ContentView; revealed?: boolean }) {
  return (
    <div className="content-card anim-pop">
      <div className="content-badges">
        <Badge variant="mint">TikTok</Badge>
        <Badge>{content.kind.toUpperCase()}</Badge>
      </div>
      {content.coverUrl ? (
        <img className="content-cover" src={content.coverUrl} alt="" loading="lazy" />
      ) : (
        <div className="content-cover-placeholder">
          <ModeIconFor mode="who_liked" size={44} />
        </div>
      )}
      <div className="content-body">
        {content.title && <p className="content-title">{content.title}</p>}
        <div className="content-meta">
          <span className="faint small">
            {content.authorName ??
              (revealed && content.kind === 'post' ? 'Posted by the player' : 'Video from a connected account')}
          </span>
          {content.webUrl && (
            <a
              className="btn btn-outline btn-sm"
              href={content.webUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              <LinkIcon size={14} /> Open on TikTok
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
