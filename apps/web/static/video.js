// The product video: switches the player between the English and Hindi versions in place.
// Self-hosted, no tracking. Without JavaScript the language buttons are plain links to the files.
const video = document.querySelector('.promo');
const buttons = document.querySelectorAll('[data-video-lang]');

function show(lang) {
  for (const button of buttons) {
    button.setAttribute('aria-pressed', String(button.dataset.videoLang === lang));
  }
}

if (video) {
  show(video.dataset.lang);
  for (const button of buttons) {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      const lang = button.dataset.videoLang;
      if (lang === video.dataset.lang) return;
      const wasPlaying = !video.paused;
      // One player, so the other language can never keep playing out of sight.
      video.pause();
      video.dataset.lang = lang;
      video.poster = `/coachingdesk-${lang}.jpg`;
      video.src = `/coachingdesk-${lang}.mp4`;
      show(lang);
      if (wasPlaying) void video.play();
    });
  }
}
