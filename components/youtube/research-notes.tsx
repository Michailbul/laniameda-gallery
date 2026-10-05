/* eslint-disable @next/next/no-img-element -- YouTube evidence thumbnails */
import { parseResearch, type Research } from "@/lib/youtube-research";
import { formatCount } from "@/lib/video-refs";

function Evidence({ reading, label }: { reading: Research["bends"][number]["demand"]; label: string }) {
  return (
    <div>
      <p className="yt-note"><span>{label}</span>{reading.summary}</p>
      {reading.evidence.length > 0 && (
        <div className="yt-stills" aria-label={`${label} evidence`}>
          {reading.evidence.map((video) => (
            <a key={video.id} className="yt-still" href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer" title={`${video.title} · ${formatCount(video.views)} views`}>
              <img src={`https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`} alt={video.title} loading="lazy" />
              <span>{formatCount(video.views)} views</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function ResearchNotes({ value, userNote }: { value?: string; userNote?: string }) {
  const research = parseResearch(value);
  return (
    <>
      {research ? (
        <>
          <p className="yt-note"><span>Research · {research.checkedAt.slice(0, 10)} · {research.sourceVerdict}</span>{research.validation}</p>
          {research.bends.map((bend, index) => (
            <section className="yt-research" key={`${bend.title}-${index}`} aria-label={`Proposal: ${bend.title}`}>
              <h2 className="yt-video-title">{bend.title}</h2>
              <p className="yt-note"><span>{bend.niche} · {bend.verdict}</span>{bend.why}</p>
              <p className="yt-note"><span>Tension</span>{bend.tension}</p>
              <p className="yt-note"><span>Urgency</span>{bend.urgency}</p>
              <p className="yt-note"><span>Our thumbnail</span>{bend.thumbnail}</p>
              <p className="yt-note"><span>Animation style</span>{bend.style}</p>
              <p className="yt-note"><span>Video format</span>{bend.format}</p>
              {bend.first30.map((beat, i) => <p className="yt-note" key={i}><span>Opens on · {['0–5 seconds', '5–15 seconds', '15–30 seconds'][i]}</span>{beat}</p>)}
              <Evidence reading={bend.demand} label="Demand" />
              <Evidence reading={bend.saturation} label="Saturation" />
              <p className="yt-note"><span>Outside YouTube · {bend.externalDemand.source}</span><a href={bend.externalDemand.url} target="_blank" rel="noopener noreferrer">{bend.externalDemand.summary}</a></p>
              {bend.toCheck.length > 0 && <p className="yt-note"><span>To check</span>{bend.toCheck.join(" · ")}</p>}
            </section>
          ))}
        </>
      ) : value ? <p className="yt-note"><span>Our bend</span>{value.trim().startsWith("{") ? "Research data needs repair before it can be shown." : value}</p> : null}
      {userNote && <p className="yt-note"><span>Your note</span>{userNote}</p>}
    </>
  );
}
