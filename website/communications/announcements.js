(() => {
  "use strict";

  const banner = document.querySelector("#announce .announce__inner > span");
  if (!banner) return;

  fetch("/api/announcements/current", { headers: { Accept: "application/json" } })
    .then((response) => {
      if (response.status === 204 || !response.ok) return null;
      return response.json();
    })
    .then((announcement) => {
      if (!announcement || !announcement.title || !announcement.message) return;

      const content = document.createDocumentFragment();
      const title = document.createElement("strong");
      title.textContent = announcement.title;
      content.append(title, document.createTextNode(` — ${announcement.message}`));

      if (announcement.link) {
        content.append(document.createTextNode(" "));
        const link = document.createElement("a");
        link.href = announcement.link;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "En savoir plus →";
        content.append(link);
      }

      banner.replaceChildren(content);
    })
    .catch(() => {
      // Keep the default static announcement if the optional feed is unavailable.
    });
})();
