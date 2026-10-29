const paths = Object.freeze({
  note: '<path d="M9 17V6.5L19 4v10.5"/><circle cx="6.5" cy="17.5" r="2.5" fill="currentColor" stroke="none"/><circle cx="16.5" cy="15" r="2.5" fill="currentColor" stroke="none"/>',
  music3Fill: '<path d="M14 12a2 2 0 1 1-4 0a2 2 0 0 1 4 0" fill="currentColor" stroke="none"/><path d="M9.5 4.926a1.5 1.5 0 0 0-1-2.829L9 3.512zm11.908 2.406a1.5 1.5 0 1 0-2.687 1.335L20.064 8zM14 3l.474-1.423A1.5 1.5 0 0 0 12.5 3zm2.526 2.423a1.5 1.5 0 1 0 .948-2.846L17 4zM21 12h-1.5a7.5 7.5 0 0 1-7.5 7.5v3c5.799 0 10.5-4.701 10.5-10.5zm-9 9v-1.5A7.5 7.5 0 0 1 4.5 12h-3c0 5.799 4.701 10.5 10.5 10.5zm-9-9h1.5a7.5 7.5 0 0 1 5-7.074L9 3.512l-.5-1.415c-4.076 1.441-7 5.328-7 9.903zm17.065-4l-1.344.667A7.46 7.46 0 0 1 19.5 12h3c0-1.674-.393-3.26-1.092-4.668zM14 3h-1.5v9h3V3zm0 0l-.474 1.423l3 1L17 4l.474-1.423l-3-1zm0 9h-1.5a.5.5 0 0 1-.5.5v3a3.5 3.5 0 0 0 3.5-3.5zm-2 2v-1.5a.5.5 0 0 1-.5-.5h-3a3.5 3.5 0 0 0 3.5 3.5zm-2-2h1.5a.5.5 0 0 1 .5-.5v-3A3.5 3.5 0 0 0 8.5 12zm2-2v1.5a.5.5 0 0 1 .5.5h3A3.5 3.5 0 0 0 12 8.5z" fill="currentColor" stroke="none"/>',
  previous: '<rect x="5.5" y="5" width="2.5" height="14" rx="1.25" fill="currentColor" stroke="none"/><path d="M18.25 5.75a1 1 0 0 1 1.6.8v10.9a1 1 0 0 1-1.6.8l-7.15-5.45a1 1 0 0 1 0-1.6l7.15-5.45Z" fill="currentColor" stroke="none"/>',
  next: '<rect x="16" y="5" width="2.5" height="14" rx="1.25" fill="currentColor" stroke="none"/><path d="M5.75 5.75a1 1 0 0 0-1.6.8v10.9a1 1 0 0 0 1.6.8l7.15-5.45a1 1 0 0 0 0-1.6L5.75 5.75Z" fill="currentColor" stroke="none"/>',
  play: '<path d="M7.25 5.15a1.15 1.15 0 0 1 1.78-.96l9.2 6.28a1.15 1.15 0 0 1 0 1.9l-9.2 6.28a1.15 1.15 0 0 1-1.78-.96V5.15Z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.75" y="5" width="4" height="14" rx="1.35" fill="currentColor" stroke="none"/><rect x="13.25" y="5" width="4" height="14" rx="1.35" fill="currentColor" stroke="none"/>',
  order: '<path d="M4.5 6.5h14M4.5 11.5h14M4.5 16.5h9.5M17 14l3 3-3 3"/>',
  repeatAll: '<path d="m17 4 3 3-3 3M20 7H8a4 4 0 0 0-4 4v1M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4v-1"/>',
  repeatOne: '<path d="m17 4 3 3-3 3M20 7H8a4 4 0 0 0-4 4v1M7 20l-3-3 3-3M4 17h12a4 4 0 0 0 4-4v-1M10.75 11l1.75-1.25V15"/>',
  shuffle: '<path d="M3.5 7h2.25c4.75 0 7 10 12 10h2.75M17.5 14l3 3-3 3M3.5 17h2.25c1.8 0 3.15-1.35 4.35-3.1M13.9 9.8C15 8.2 16.3 7 18.25 7h2.25M17.5 4l3 3-3 3"/>',
  back: '<path d="m13.5 5-7 7 7 7M7 12h11"/>'
});

export function icon(name, label = "") {
  return `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="${label ? "false" : "true"}">${paths[name] || paths.note}</svg>`;
}
