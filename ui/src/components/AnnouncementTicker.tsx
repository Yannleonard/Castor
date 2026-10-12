import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useLang } from "../i18n";
import "../styles/announcement.css";

const labels = {
  en: { info: "INFO", update: "RELEASE", commercial: "OFFER" },
  fr: { info: "INFO", update: "VERSION", commercial: "OFFRE" },
} as const;

export function AnnouncementTicker() {
  const lang = useLang();
  const query = useQuery({
    queryKey: ["announcement", "current"],
    queryFn: api.currentAnnouncement,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const announcement = query.data;
  if (!announcement) return <div className="announcement-slot" aria-hidden="true" />;

  const content = (
    <>
      {announcement.imageData ? <img className="announcement-image" src={announcement.imageData} alt="" /> : null}
      <span className={`announcement-kind announcement-kind-${announcement.kind}`}>
        {labels[lang][announcement.kind]}
      </span>
      <strong className="announcement-title">{announcement.title}</strong>
      <span className="announcement-message">{announcement.message}</span>
      {announcement.link ? <span className="announcement-arrow" aria-hidden="true">↗</span> : null}
    </>
  );

  return (
    <div className="announcement-slot" aria-label={lang === "fr" ? "Annonce Castor" : "Castor announcement"}>
      {announcement.link ? (
        <a
          className="announcement-ticker"
          href={announcement.link}
          target="_blank"
          rel="noopener noreferrer"
          title={`${announcement.title}: ${announcement.message}`}
        >
          {content}
        </a>
      ) : (
        <div className="announcement-ticker" title={`${announcement.title}: ${announcement.message}`}>
          {content}
        </div>
      )}
    </div>
  );
}