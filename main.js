/*
  abcPlay single-page app
  - Implements landing slideshow -> dashboard crossfade
  - Uses the provided open-access endpoints for search and detail
  - Debounced autocomplete, carousels, detail modal with simulated player
*/

/* --------------------------
   Embedded Ad-Blocker Simulation
   - MutationObserver to strip script tags matching ad/pop domains
   - Enhanced window defenses and click interceptor for outbound _blank redirects
   -------------------------- */
(function installNetworkShield() {
  try {
    // simple list of suspicious substrings to match against script src
    const AD_PATTERNS = ['fapi', 'adsystem', 'popads', 'clickunder', 'juicyads', 'taboola', 'revcontent', 'adservice', 'ads.', 'doubleclick', 'adserver'];

    function looksLikeAdUrl(url) {
      if (!url || typeof url !== 'string') return false;
      const u = url.toLowerCase();
      return AD_PATTERNS.some(p => u.includes(p));
    }

    // Remove and prevent execution of suspicious script nodes immediately
    function handleNewNode(node) {
      try {
        if (!node) return;
        if (node.tagName === 'SCRIPT') {
          const src = node.getAttribute && node.getAttribute('src');
          if (looksLikeAdUrl(src)) {
            try { node.remove(); } catch(e){}
            console.warn('NetworkShield: removed blocked script', src);
            return;
          }
        }
        // also guard inline scripts that might be ad-snippets by checking content
        if (node.tagName === 'SCRIPT' && !node.src && node.textContent) {
          const txt = node.textContent.toLowerCase();
          if (AD_PATTERNS.some(p => txt.includes(p))) {
            try { node.remove(); } catch(e){}
            console.warn('NetworkShield: removed blocked inline script');
            return;
          }
        }
        // if nodes contain elements with potential ad iframes, remove them too
        if (node.tagName === 'IFRAME') {
          const src = node.getAttribute && node.getAttribute('src');
          if (looksLikeAdUrl(src)) {
            try { node.remove(); } catch(e){}
            console.warn('NetworkShield: removed blocked iframe', src);
            return;
          }
        }
      } catch (e) {
        /* swallow */
      }
    }

    // Observe head and body for script/iframe insertions
    const observer = new MutationObserver(muts => {
      for (const m of muts) {
        if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) {
          for (const node of Array.from(m.addedNodes)) {
            try {
              // pre-emptively stop execution by removing node before it's appended in some browsers
              handleNewNode(node);
              // if element contains nested scripts/iframes, sweep them
              if (node.querySelectorAll) {
                const scripts = node.querySelectorAll('script, iframe');
                for (const s of Array.from(scripts)) handleNewNode(s);
              }
            } catch (e) {}
          }
        }
      }
    });

    observer.observe(document.documentElement || document, { childList: true, subtree: true });

    // Also hook into appendChild/insertBefore to catch direct DOM API insertions
    const origAppend = Element.prototype.appendChild;
    Element.prototype.appendChild = function(child) {
      try { handleNewNode(child); } catch(e){}
      return origAppend.call(this, child);
    };
    const origInsBefore = Element.prototype.insertBefore;
    Element.prototype.insertBefore = function(newNode, refNode) {
      try { handleNewNode(newNode); } catch(e){}
      return origInsBefore.call(this, newNode, refNode);
    };

    // Enhanced window defenses (popup/redirect blockers)
    try {
      window.open = function() { return null; };
    } catch (e) {}
    try {
      window.Focus = function() {};
    } catch (e) {}

    // Intercept outbound _blank clicks and block suspicious targets
    document.addEventListener('click', function(e) {
      try {
        const tgt = e.target;
        if (!tgt) return;
        // capture anchor clicks with target blank
        if (tgt.tagName === 'A' && tgt.target === '_blank') {
          const href = tgt.href || '';
          // allow same-origin or known good hosts (tmdb, youtube, your domain)
          const allowHosts = [window.location.hostname, 'tmdb.org', 'themoviedb.org', 'youtube.com', 'youtu.be', 'vidsrcme.su'];
          const isAllowed = allowHosts.some(h => href.includes(h));
          if (!isAllowed) {
            e.preventDefault();
            e.stopImmediatePropagation();
            console.warn('NetworkShield: Blocked background redirect link to:', href);
          }
        }
      } catch (err) {}
    }, true);

    // Expose a flag for other code to detect shield presence
    window.__abcPlayNetworkShield = true;
    console.info('NetworkShield installed');
  } catch (err) {
    console.warn('NetworkShield failed to install', err);
  }
})();

/*
  TMDB integration attempt:
  - We try to fetch TMDB-like data through a public proxy wrapper. If CORS or API key constraints block requests
    we fallback to a local mock dataset (TMDB-like objects).
  - VidLink integration uses https://vidlink.pro/movie/[TMDB_ID] and https://vidlink.pro/tv/[TMDB_ID]/S/E
*/
/* TMDB credentials (hardcoded as requested) */
const TMDB_API_KEY = "04fd9b8bd4c9a6f3fa5c3cf2b4464cf5";
const TMDB_READ_TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiIwNGZkOWI4YmQ0YzlhNmYzZmE1YzNjZjJiNDQ2NGNmNSIsIm5iZiI6MTc3OTA0Njg4Mi41OTYsInN1YiI6IjZhMGExOWUyZjM5ZjIzNmZhNWRmYjJjOSIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.kJLhDSP8Z3hBjkpj15kRPcs9ePkhAJjAq52VF-zYlpI";

/* TMDB image helper (use w500 for cards) */
const TMDB_IMG = path => path ? `https://image.tmdb.org/t/p/w500${path}` : null;

/* API helper constructors */
const API_SEARCH = (q) => `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(q)}&language=en-US&include_adult=false`;
const API_TRENDING_ALL_WEEK = () => `https://api.themoviedb.org/3/trending/all/week?api_key=${TMDB_API_KEY}&language=en-US`;
const API_NOW_PLAYING = () => `https://api.themoviedb.org/3/movie/now_playing?api_key=${TMDB_API_KEY}&language=en-US&page=1`;
const API_TRENDING_TV = () => `https://api.themoviedb.org/3/trending/tv/week?api_key=${TMDB_API_KEY}&language=en-US`;
const API_DISCOVER_GENRE = (genreId) => `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&with_genres=${genreId}&language=en-US&sort_by=popularity.desc`;

/* Detail endpoints */
const API_DETAIL_MOVIE = (id) => `https://api.themoviedb.org/3/movie/${id}?api_key=${TMDB_API_KEY}&language=en-US&append_to_response=videos,credits`;
const API_DETAIL_TV = (id) => `https://api.themoviedb.org/3/tv/${id}?api_key=${TMDB_API_KEY}&language=en-US&append_to_response=videos,credits`;

/* Simple internal mock TMDB-like dataset used if remote calls are blocked */
const MOCK_TMDB = [
  { id: 101, title: "Mock: The Last Frontier", poster_path: "/mock1.jpg", backdrop_path: "/mock1b.jpg", vote_average: 8.1, overview: "An epic mock adventure.", release_date: "2023-10-01", media_type: "movie" },
  { id: 102, title: "Mock: Night City", poster_path: "/mock2.jpg", backdrop_path: "/mock2b.jpg", vote_average: 7.8, overview: "A neon action thriller.", release_date: "2024-02-14", media_type: "movie" },
  { id: 201, title: "Mock: Rising Stars", poster_path: "/mock3.jpg", backdrop_path: "/mock3b.jpg", vote_average: 7.4, overview: "A delightful ensemble.", first_air_date: "2024-01-10", media_type: "tv" }
];

/* Fallback placeholders (Unsplash URLs) used on errors */
const FALLBACK_IMAGES = [
  "https://images.unsplash.com/photo-1497032628192-86f99bcd76bc?q=80&w=1600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1505685296765-3a2736de412f?q=80&w=1600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1517604931442-5d5a0e1bbf1b?q=80&w=1600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1519681393784-d120267933ba?q=80&w=1600&auto=format&fit=crop",
  "https://images.unsplash.com/photo-1524985069026-dd778a71c7b4?q=80&w=1600&auto=format&fit=crop"
];

const qs = s => document.querySelector(s);
const qsa = s => Array.from(document.querySelectorAll(s));

/* App state */
let state = {
  view: "landing", // landing | dashboard
  slides: [],
  carousels: {},
  debounceTimer: null,
  slideIndex: 0,
  slideTimer: null,
  pendingFetches: []
};

// current media engine instances for strict teardown
let __abcCurrentPlayer = null;
let __abcCurrentHls = null;

/* ---- Helpers ---- */
function safeFetch(url, fallbackData = null) {
  return fetch(url).then(res => {
    if (!res.ok) throw new Error("Network response not ok");
    return res.json();
  }).catch(err => {
    console.warn("Fetch failed:", url, err);
    return fallbackData;
  });
}

function pickFallback(idx = 0) {
  return FALLBACK_IMAGES[idx % FALLBACK_IMAGES.length];
}

/* ---- Landing Slideshow ---- */
const initialSearches = ["Dune", "Top Gun", "Avatar", "John Wick", "The Batman"];

function safeImageForShow(item, fallbackIdx=0) {
  if (!item) return pickFallback(fallbackIdx);
  // Accept TMDB-style poster/backdrop paths or local Unsplash fallback
  const poster = item.poster_path || item.backdrop_path || item.poster || item.backdrop;
  if (poster && poster.startsWith("/")) {
    // map to mock Unsplash for masked mock paths (we don't embed base TMDB images for mock)
    // if real TMDB path available, map to TMDB image service
    return TMDB_IMG(poster) || pickFallback(fallbackIdx);
  }
  return item.image?.original || item.image?.medium || item.poster || pickFallback(fallbackIdx);
}

async function loadLandingSlides() {
  const slidesEl = qs("#slideshow");
  const dotsEl = qs("#dots");
  slidesEl.innerHTML = "";
  dotsEl.innerHTML = "";

  // Fetch TMDB trending all/week for high quality backdrops
  const trending = await safeFetch(API_TRENDING_ALL_WEEK(), null);
  const results = (trending && Array.isArray(trending.results) && trending.results.length) ? trending.results.slice(0,5) : MOCK_TMDB.slice(0,5);

  state.slides = results.map((r, idx) => {
    const img = r.backdrop_path ? TMDB_IMG(r.backdrop_path) : (r.poster_path ? TMDB_IMG(r.poster_path) : pickFallback(idx));
    const title = r.title || r.name || "";
    return { image: img, title, raw: r };
  });

  state.slides.forEach((sl, i) => {
    const slide = document.createElement("div");
    slide.className = "slide" + (i===0 ? " active" : "");
    slide.style.backgroundImage = `url("${sl.image}")`;
    slide.dataset.index = i;
    slidesEl.appendChild(slide);

    const dot = document.createElement("div");
    dot.className = "dot";
    const prog = document.createElement("div");
    prog.className = "progress";
    dot.appendChild(prog);
    dot.addEventListener("click", ()=> jumpToSlide(i));
    dotsEl.appendChild(dot);
  });

  startSlideRotation();
}

function startSlideRotation() {
  stopSlideRotation();
  advanceProgressBar();
  state.slideTimer = setInterval(()=>{
    nextSlide();
  }, 5000);
}

function stopSlideRotation(){
  clearInterval(state.slideTimer);
  state.slideTimer = null;
  // reset progress bars
  qsa(".dot .progress").forEach(p => p.style.width = "0%");
}

function advanceProgressBar() {
  qsa(".dot .progress").forEach((p, idx) => p.style.width = idx===state.slideIndex ? "100%" : "0%");
  // reset and animate the current one (force reflow)
  const cur = qsa(".dot .progress")[state.slideIndex];
  if (cur) {
    cur.style.transition = "none";
    cur.style.width = "0%";
    // force reflow
    void cur.offsetWidth;
    cur.style.transition = "width 5s linear";
    cur.style.width = "100%";
  }
}

function nextSlide(){
  const slides = qsa(".slide");
  slides[state.slideIndex]?.classList.remove("active");
  state.slideIndex = (state.slideIndex + 1) % slides.length;
  slides[state.slideIndex]?.classList.add("active");
  advanceProgressBar();
}

function jumpToSlide(i){
  stopSlideRotation();
  qsa(".slide").forEach(s=>s.classList.remove("active"));
  state.slideIndex = i;
  qsa(".slide")[i]?.classList.add("active");
  startSlideRotation();
}

/* ---- Landing -> Dashboard Transition ---- */
const enterBtn = qs("#enterBtn");
enterBtn?.addEventListener("click", () => {
  // cross-fade
  const landing = qs("#landing");
  const dashboard = qs("#dashboard");
  landing.classList.add("landing-hidden");
  landing.classList.remove("landing-visible");
  setTimeout(()=> {
    dashboard.classList.remove("dashboard-hidden");
    dashboard.classList.add("dashboard-visible");
  }, 350);
});

/* ---- Dashboard: Autocomplete ---- */
const searchInput = qs("#searchInput");
const autocomplete = qs("#autocomplete");

function debounce(fn, wait=300){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(()=> fn.apply(this,args), wait);
  };
}

async function performSearch(query) {
  if (!query || query.trim().length < 1) {
    autocomplete.classList.add("hidden");
    autocomplete.innerHTML = "";
    return;
  }
  // show loading skeleton
  autocomplete.classList.remove("hidden");
  autocomplete.innerHTML = Array.from({length:3}).map(()=>`<div class="suggestion skeleton" style="height:76px;border-radius:8px"></div>`).join("");

  const data = await safeFetch(API_SEARCH(query), { results: [] });
  const rawList = (data && Array.isArray(data.results)) ? data.results.slice(0,7) : [];
  // Ensure media_type is explicit for each search result
  const list = rawList.map(item => {
    if (!item.media_type) {
      if (item.first_air_date || item.name) item.media_type = 'tv';
      else if (item.release_date || item.title) item.media_type = 'movie';
      else item.media_type = 'movie';
    }
    return item;
  });

  if (list.length === 0) {
    autocomplete.innerHTML = `<div class="suggestion"><div style="width:48px;height:72px;background:#222;border-radius:6px"></div><div class="meta"><div style="font-weight:700">No results</div><div class="muted">Try another search</div></div></div>`;
    return;
  }

  autocomplete.innerHTML = "";
  list.forEach(entry => {
    const item = entry;
    const media = item.media_type || (item.title ? "movie" : "tv");
    const thumb = item.poster_path ? TMDB_IMG(item.poster_path) : pickFallback(Math.floor(Math.random()*5));
    const title = item.title || item.name || "Untitled";
    const year = (item.release_date || item.first_air_date || "").slice(0,4) || "";
    const summary = (item.overview || "").slice(0,120);
    const el = document.createElement("div");
    el.className = "suggestion";
    el.innerHTML = `<img src="${thumb}" alt="${title}" /><div class="meta"><div style="font-weight:700">${title} ${year?`(${year})`:''}</div><div class="muted">${summary}</div></div>`;
    el.addEventListener("click", ()=> openDetail(item));
    autocomplete.appendChild(el);
  });
}

const debouncedSearch = debounce((e) => performSearch(e.target.value), 300);
searchInput.addEventListener("input", debouncedSearch);

/* ---- Carousels: fetch categories in parallel ---- */
/* Newest Releases integration: add a dedicated newest carousel at top and ensure it's populated
   with recent/high-profile series; we query a set of modern titles and sort by premiered date desc */
const carouselConfig = [
  { key: "newest", title: "Newest Movies", fetcher: API_NOW_PLAYING, media_type: "movie" },
  { key: "trending", title: "Trending Shows", fetcher: API_TRENDING_TV, media_type: "tv" },
  { key: "action", title: "Blockbuster Action", fetcher: () => API_DISCOVER_GENRE(28), media_type: "movie" }
];

async function populateCarousels() {
  const carouselsEl = qs("#carousels");
  carouselsEl.innerHTML = "";

  // render skeletons quickly
  carouselConfig.forEach(cfg => {
    const section = document.createElement("section");
    section.className = "carousel";
    section.innerHTML = `<h3>${cfg.title}</h3><div class="row">${Array.from({length:6}).map(()=>`<div class="card skeleton" style="width:180px;height:270px;border-radius:8px"></div>`).join("")}</div>`;
    carouselsEl.appendChild(section);
  });

  // fetch each configured endpoint
  const resolved = await Promise.all(carouselConfig.map(async cfg => {
    try {
      const data = await safeFetch(cfg.fetcher(), null);
      const items = (data && Array.isArray(data.results)) ? data.results.map(r => {
        // Inject explicit media_type where missing
        const media_type = r.media_type || (r.first_air_date || r.name ? 'tv' : (r.release_date || r.title ? 'movie' : 'movie'));
        return {
          id: r.id,
          title: media_type === 'movie' ? (r.title || r.name) : (r.name || r.title),
          poster_path: r.poster_path,
          backdrop_path: r.backdrop_path,
          vote_average: r.vote_average || (r.vote && r.vote.average),
          overview: r.overview || r.summary || "",
          release_date: media_type === 'movie' ? (r.release_date || "") : (r.first_air_date || ""),
          media_type
        };
      }) : (MOCK_TMDB.filter(m => !cfg.media_type || m.media_type === cfg.media_type));
      return { key: cfg.key, title: cfg.title, items: items.slice(0,12) };
    } catch (err) {
      return { key: cfg.key, title: cfg.title, items: MOCK_TMDB.filter(m => !cfg.media_type || m.media_type === cfg.media_type) };
    }
  }));

  // render
  carouselsEl.innerHTML = "";
  resolved.forEach(car => {
    const section = document.createElement("section");
    section.className = "carousel";
    if (car.key === "newest") section.id = "carousel-newest";
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = car.items.map(it => {
      const img = it.poster_path ? TMDB_IMG(it.poster_path) : pickFallback(0);
      const title = it.title || it.name || "Untitled";
      const year = (it.release_date || "").slice(0,4) || "";
      const rating = (it.vote_average !== undefined ? it.vote_average : "—");
      return `<div class="card" data-id="${it.id || ''}" data-type="${it.media_type || 'movie'}">
          <img loading="lazy" src="${img}" alt="${title}" />
          <div class="badge">${rating} ★</div>
          <div class="overlay"><div class="title">${title} ${year?`(${year})`:''}</div>
          <button class="quick-play" data-id="${it.id}" data-type="${it.media_type||'movie'}">Quick Play</button>
          </div>
        </div>`;
    }).join("");
    section.innerHTML = `<h3>${car.title}</h3>`;
    section.appendChild(row);
    carouselsEl.appendChild(section);
  });

  // events
  qsa(".card").forEach(card=>{
    card.addEventListener("click", (e)=> {
      if (e.target.classList.contains("quick-play")) return;
      const dataId = card.dataset.id;
      const type = card.dataset.type || "movie";
      const img = card.querySelector("img")?.src;
      openDetail({ id: dataId, media_type: type }, img);
    });
  });
  qsa(".quick-play").forEach(btn=>{
    btn.addEventListener("click", (e)=>{
      const id = btn.dataset.id;
      const type = btn.dataset.type || "movie";
      openDetail({ id, media_type: type }, null).then(()=> {
        setTimeout(()=> {
          qs("#playerSim .server-btn[data-mode='live']")?.click();
        }, 300);
      });
    });
  });

  // Navigation view switching (Home / Newest Movies / Shows / My List)
  const navLinks = qsa('.nav a');
  let currentView = 'home';
  function setActiveNav(key) {
    currentView = key;
    navLinks.forEach(a => {
      a.classList.remove('nav-link-active');
      if (a.dataset && a.dataset.nav === key) a.classList.add('nav-link-active');
    });
  }

  // attach behavior to nav links
  navLinks.forEach(link => {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      const key = link.dataset.nav;
      setActiveNav(key);
      // reset scroll and UI states
      qs("#carousels").innerHTML = "";
      if (key === 'home') {
        // show full dashboard (carousel layout + hero)
        qs("#landing")?.classList.add("landing-hidden");
        qs("#dashboard")?.classList.remove("dashboard-hidden");
        qs("#dashboard")?.classList.add("dashboard-visible");
        window.scrollTo({ top: 0, behavior: 'smooth' });
        await populateCarousels();
        // restore hero
        qs(".hero") && (qs(".hero").style.display = '');
      } else if (key === 'newest') {
        // show newest movies grid (discover by primary release date desc)
        window.scrollTo({ top: 0, behavior: 'smooth' });
        qs(".hero") && (qs(".hero").style.display = 'none');
        const container = qs("#carousels");
        container.innerHTML = `<section class="carousel"><h3>Newest Releases</h3><div id="newest-grid" class="row" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;padding:12px 6px"></div></section>`;
        const grid = qs("#newest-grid");
        const url = `https://api.themoviedb.org/3/discover/movie?api_key=${TMDB_API_KEY}&language=en-US&sort_by=primary_release_date.desc&page=1`;
        const data = await safeFetch(url, { results: MOCK_TMDB });
        const items = (data && Array.isArray(data.results)) ? data.results.filter(r => !(r.first_air_date || r.name)).slice(0,24) : MOCK_TMDB.filter(m => m.media_type==='movie');
        grid.innerHTML = items.map(it => {
          const img = it.poster_path ? TMDB_IMG(it.poster_path) : pickFallback(0);
          const title = it.title || it.name || "Untitled";
          const year = (it.release_date || "").slice(0,4) || "";
          const rating = (it.vote_average !== undefined ? it.vote_average : "—");
          return `<div class="card" data-id="${it.id}" data-type="movie"><img loading="lazy" src="${img}" alt="${title}" /><div class="badge">${rating} ★</div><div class="overlay"><div class="title">${title} ${year?`(${year})`:''}</div></div></div>`;
        }).join('');
        // wire clicks
        qsa('.card').forEach(c=> c.addEventListener('click', ()=> openDetail({ id: c.dataset.id, media_type: 'movie' }, c.querySelector('img')?.src)));
      } else if (key === 'tv') {
        // shows grid (tv-centric)
        window.scrollTo({ top: 0, behavior: 'smooth' });
        qs(".hero") && (qs(".hero").style.display = 'none');
        const container = qs("#carousels");
        container.innerHTML = `<section class="carousel"><h3>Trending Shows</h3><div id="tv-grid" class="row" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;padding:12px 6px"></div></section>`;
        const grid = qs("#tv-grid");
        const data = await safeFetch(API_TRENDING_TV(), { results: MOCK_TMDB });
        const items = (data && Array.isArray(data.results)) ? data.results.filter(r=> (r.first_air_date || r.name)).slice(0,24) : MOCK_TMDB.filter(m=>m.media_type==='tv');
        grid.innerHTML = items.map(it => {
          const img = it.poster_path ? TMDB_IMG(it.poster_path) : pickFallback(1);
          const title = it.name || it.title || "Untitled";
          const year = (it.first_air_date || "").slice(0,4) || "";
          const rating = (it.vote_average !== undefined ? it.vote_average : "—");
          return `<div class="card" data-id="${it.id}" data-type="tv"><img loading="lazy" src="${img}" alt="${title}" /><div class="badge">${rating} ★</div><div class="overlay"><div class="title">${title} ${year?`(${year})`:''}</div></div></div>`;
        }).join('');
        qsa('.card').forEach(c=> c.addEventListener('click', ()=> openDetail({ id: c.dataset.id, media_type: 'tv' }, c.querySelector('img')?.src)));
      } else if (key === 'list') {
        // My List — simplistic local array demo
        window.scrollTo({ top: 0, behavior: 'smooth' });
        qs(".hero") && (qs(".hero").style.display = 'none');
        const container = qs("#carousels");
        const saved = JSON.parse(localStorage.getItem('abcplay_mylist') || '[]');
        if (!saved || saved.length === 0) {
          container.innerHTML = `<div style="height:60vh;display:flex;align-items:center;justify-content:center"><div style="text-align:center;color:var(--muted)"><h3>Your List is empty</h3><p>Add titles to "My List" to see them here.</p></div></div>`;
        } else {
          container.innerHTML = `<section class="carousel"><h3>My List</h3><div id="mylist-grid" class="row" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px;padding:12px 6px"></div></section>`;
          qs('#mylist-grid').innerHTML = saved.map(it => {
            const img = it.poster_path ? TMDB_IMG(it.poster_path) : pickFallback(2);
            return `<div class="card" data-id="${it.id}" data-type="${it.media_type||'movie'}"><img loading="lazy" src="${img}" alt="${it.title||it.name||'Saved'}" /><div class="overlay"><div class="title">${it.title||it.name}</div></div></div>`;
          }).join('');
          qsa('.card').forEach(c=> c.addEventListener('click', ()=> openDetail({ id: c.dataset.id, media_type: c.dataset.type }, c.querySelector('img')?.src)));
        }
      }
    });
  });

  // set default active nav
  setActiveNav('home');
}

/* ---- Detail Modal & Player Simulation ---- */
const modal = qs("#detailModal");
const modalClose = qs("#modalClose");
const modalTitle = qs("#modalTitle");
const metaRow = qs("#metaRow");
const genreTags = qs("#genreTags");
const descriptionEl = qs("#description");
const mediaPoster = qs("#mediaPoster");
const playBtn = qs("#playBtn");
const playerSim = qs("#playerSim");
const simVideo = qs("#simVideo");
const playToggle = qs("#playToggle");
const volumeEl = qs("#volume");
const timeline = qs("#timeline");
const subsToggle = qs("#subsToggle");
const buffer = qs("#buffer");

modalClose.addEventListener("click", closeModal);
modal.addEventListener("click", (e)=> { if (e.target === modal) closeModal(); });

async function openDetailFromSuggestion(item) {
  const id = item.id || item.show?.id || item.show?.url || "";
  const show = item.show || item;
  const image = safeImageForShow(show, 0);
  await openDetail(show.id || id, image);
}

async function openDetail(idOrObj, image) {
  // Normalize incoming id/object and determine media_type robustly
  let id, providedType;
  if (typeof idOrObj === "object") {
    id = idOrObj.id || idOrObj;
    providedType = idOrObj.media_type || (idOrObj.first_air_date || idOrObj.name ? 'tv' : (idOrObj.release_date || idOrObj.title ? 'movie' : null));
  } else {
    id = idOrObj;
    providedType = null;
  }

  modal.classList.remove("hidden");
  modalTitle.textContent = "Loading...";
  metaRow.textContent = "";
  genreTags.innerHTML = "";
  descriptionEl.textContent = "";
  mediaPoster.classList.add("skeleton");
  mediaPoster.style.backgroundImage = `url("${image || pickFallback(0)}")`;
  playerSim.classList.add("hidden");
  buffer.classList.add("hidden");

  // Fetch the authoritative detail from TMDB (prefer explicit type when provided)
  let item = null;
  let resolvedType = providedType;
  try {
    if (resolvedType === 'tv') {
      item = await safeFetch(API_DETAIL_TV(id), null);
    } else if (resolvedType === 'movie') {
      item = await safeFetch(API_DETAIL_MOVIE(id), null);
    } else {
      // Best-effort: try movie then tv
      item = await safeFetch(API_DETAIL_MOVIE(id), null);
      if (item && item.id) resolvedType = 'movie';
      else {
        item = await safeFetch(API_DETAIL_TV(id), null);
        if (item && item.id) resolvedType = 'tv';
      }
    }
  } catch (err) {
    item = null;
  }

  // If still null, bail with fallback mock
  if (!item) {
    modalTitle.textContent = "Unavailable";
    descriptionEl.textContent = "Details could not be loaded.";
    mediaPoster.classList.remove("skeleton");
    mediaPoster.style.backgroundImage = `url("${pickFallback(0)}")`;
    return;
  }

  // Normalize display fields by media type
  const isTv = resolvedType === 'tv' || !!item.first_air_date || !!item.name;
  const title = isTv ? (item.name || item.title || "Unknown Title") : (item.title || item.name || "Unknown Title");
  const release = isTv ? (item.first_air_date || "") : (item.release_date || "");
  const year = release ? release.slice(0,4) : "";
  const rating = (item.vote_average !== undefined ? item.vote_average : "—");
  const runtime = !isTv ? (item.runtime ? `${item.runtime} min` : "") : (item.episode_run_time && item.episode_run_time[0] ? `${item.episode_run_time[0]} min` : "");
  const genres = Array.isArray(item.genres) ? item.genres.map(g=>g.name) : [];
  const plot = (item.overview) || "Description unavailable.";

  modalTitle.textContent = title;
  metaRow.textContent = `${year} • ${rating} ★ ${runtime ? `• ${runtime}` : ''}`;
  genreTags.innerHTML = genres.slice(0,6).map(g=>`<div class="tag">${g}</div>`).join("");
  descriptionEl.textContent = plot;

  // poster/backdrop fallback
  const hires = (item.poster_path ? TMDB_IMG(item.poster_path) : (item.backdrop_path ? TMDB_IMG(item.backdrop_path) : (image || pickFallback(0))));
  mediaPoster.classList.remove("skeleton");
  mediaPoster.style.backgroundImage = `url("${hires}")`;

  // Prepare player containers (movie container with sandboxed VidLink iframe and trailer container for YouTube)
  const movieContainer = qs("#movieContainer");
  const trailerContainer = qs("#trailerContainer");
  const episodeControls = qs("#episodeControls");
  const seasonSelect = qs("#seasonSelect");
  const episodeSelect = qs("#episodeSelect");

  // Build trailer URL (YouTube priority) from videos array
  let trailerKey = "";
  if (item && item.videos && Array.isArray(item.videos.results)) {
    const youtube = item.videos.results.find(v => v.site && v.site.toLowerCase().includes("youtube") && v.type && v.type.toLowerCase().includes("trailer"));
    if (youtube) trailerKey = youtube.key;
    else if (item.videos.results.length) {
      const v = item.videos.results.find(vv => vv.site && vv.site.toLowerCase().includes("youtube"));
      if (v) trailerKey = v.key;
    }
  }

  // Ensure containers are cleared first (strict lifecycle)
  movieContainer.innerHTML = "";
  trailerContainer.innerHTML = "";
  trailerContainer.classList.add("hidden");

  // VidLink default src depending on normalized type
  const typeForVid = isTv ? 'tv' : 'movie';

  // Replace custom player / proxy scraping with a direct VidLink iframe embed.
  // mountVidsrc now injects the official VidLink embed iframe (movie or tv) and does strict teardown.
  function mountVidsrc(season = null, episode = null) {
    try {
      // Teardown any previous player references
      if (__abcCurrentHls) { try { __abcCurrentHls.destroy(); } catch(e){}; __abcCurrentHls = null; }
      if (__abcCurrentPlayer) { try { __abcCurrentPlayer.pause(); } catch(e){}; __abcCurrentPlayer = null; }
    } catch(e){}

    movieContainer.innerHTML = "";
    trailerContainer.innerHTML = "";
    movieContainer.classList.remove('hidden');
    trailerContainer.classList.add('hidden');

    // construct VidLink URL using existing helper
    const src = createVidlinkUrl(id, typeForVid, season || 1, episode || 1);
    if (!src) {
      movieContainer.innerHTML = `<div style="padding:20px;color:var(--muted);text-align:center">Invalid media source</div>`;
      return;
    }

    // create iframe element for VidLink
    const iframe = document.createElement('iframe');
    iframe.src = src;
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('webkitallowfullscreen', 'true');
    iframe.setAttribute('mozallowfullscreen', 'true');
    iframe.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
    // sizing handled by CSS rules (.vidlink-wrap iframe)
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.aspectRatio = '16/9';
    iframe.style.border = 'none';
    iframe.style.display = 'block';
    iframe.loading = 'lazy';

    // insert iframe and keep no other players active
    movieContainer.appendChild(iframe);

    // keep a reference so we can teardown quickly
    __abcCurrentPlayer = iframe;
  }
  // alias for legacy usage
  const mountVidlink = mountVidsrc;

  // mountTrailer: fully destroy VidLink iframe and create YouTube embed (autoplay)
  function mountTrailer() {
    // full teardown of VidLink iframe
    try {
      if (__abcCurrentPlayer && __abcCurrentPlayer.remove) {
        __abcCurrentPlayer.remove();
      }
      __abcCurrentPlayer = null;
    } catch(e){}

    movieContainer.innerHTML = "";
    trailerContainer.innerHTML = "";
    trailerContainer.classList.remove('hidden');

    if (trailerKey) {
      const yt = document.createElement('iframe');
      yt.setAttribute('frameborder', '0');
      yt.setAttribute('allowfullscreen', 'true');
      yt.setAttribute('webkitallowfullscreen', 'true');
      yt.setAttribute('mozallowfullscreen', 'true');
      yt.setAttribute('allow', 'autoplay; fullscreen; encrypted-media; picture-in-picture');
      yt.src = `https://www.youtube.com/embed/${trailerKey}?autoplay=1`;
      yt.style.width = '100%';
      yt.style.height = '100%';
      yt.style.aspectRatio = '16/9';
      yt.style.border = 'none';
      yt.style.display = 'block';
      yt.loading = 'lazy';
      trailerContainer.appendChild(yt);
    } else {
      trailerContainer.innerHTML = `<div style="padding:18px;color:var(--muted);text-align:center">Trailer unavailable</div>`;
    }
  }

  // default season/episode values for tv
  let defaultSeason = 1;
  let defaultEpisode = 1;

  if (typeForVid === 'tv') {
    episodeControls.classList.remove("hidden");
    seasonSelect.innerHTML = `<option>Loading…</option>`;
    episodeSelect.innerHTML = `<option>Loading…</option>`;
    (async ()=>{
      try {
        const tvFull = await safeFetch(API_DETAIL_TV(id), item);
        const seasons = Array.isArray(tvFull.seasons) ? tvFull.seasons : (item.seasons || []);
        defaultSeason = seasons[0]?.season_number || (tvFull.number_of_seasons || 1);
        seasonSelect.innerHTML = seasons.map(s=>`<option value="${s.season_number}">S${s.season_number}</option>`).join("") || Array.from({length:(tvFull.number_of_seasons||1)}).map((_,i)=>`<option value="${i+1}">S${i+1}</option>`).join("");
        // fetch season details for episode count
        const sec = await safeFetch(`https://api.themoviedb.org/3/tv/${id}/season/${defaultSeason}?api_key=${TMDB_API_KEY}&language=en-US`, null);
        const epCount = sec && Array.isArray(sec.episodes) ? sec.episodes.length : 10;
        episodeSelect.innerHTML = Array.from({length: Math.max(1, epCount)}).map((_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
        defaultEpisode = 1;
        // mount vidlink with the default season/episode
        mountVidlink(defaultSeason, defaultEpisode);
      } catch (err) {
        seasonSelect.innerHTML = `<option value="1">S1</option>`;
        episodeSelect.innerHTML = Array.from({length:10}).map((_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
        mountVidlink(1,1);
      }
    })();
  } else {
    episodeControls.classList.add("hidden");
    mountVidlink();
  }

  // wire tab buttons for strict mount/unmount behavior (VidSrc)
  qsa(".tab-btn").forEach(btn => {
    btn.classList.remove("active");
    btn.onclick = (ev) => {
      qsa(".tab-btn").forEach(b=>b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      if (tab === "trailer") {
        // mount trailer (destroys vidsrc iframe)
        mountTrailer();
      } else {
        // mount vidsrc (destroys trailer iframe)
        const s = seasonSelect?.value || defaultSeason;
        const e = episodeSelect?.value || defaultEpisode;
        mountVidsrc(s,e);
        trailerContainer.innerHTML = "";
        trailerContainer.classList.add("hidden");
      }
    };
  });

  // Handle season/episode selection changes with spinner and immediate VidSrc re-mount
  if (!episodeControls.classList.contains("hidden")) {
    seasonSelect.onchange = async () => {
      const s = seasonSelect.value;
      buffer.classList.remove("hidden");
      try {
        const sec = await safeFetch(`https://api.themoviedb.org/3/tv/${id}/season/${s}?api_key=${TMDB_API_KEY}&language=en-US`, null);
        const eps = sec && Array.isArray(sec.episodes) ? sec.episodes.length : 10;
        episodeSelect.innerHTML = Array.from({length: Math.max(1, eps)}).map((_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
        // re-mount VidSrc with new season and first episode
        mountVidsrc(s, 1);
      } catch (err) {
        episodeSelect.innerHTML = Array.from({length:10}).map((_,i)=>`<option value="${i+1}">${i+1}</option>`).join("");
        mountVidsrc(s, 1);
      } finally {
        setTimeout(()=> buffer.classList.add("hidden"), 600);
      }
    };
    episodeSelect.onchange = () => {
      const s = seasonSelect.value;
      const e = episodeSelect.value;
      buffer.classList.remove("hidden");
      mountVidsrc(s, e);
      setTimeout(()=> buffer.classList.add("hidden"), 600);
    };
  }

  // Show the movie tab by default (VidLink mounted above)
}

/* modal controls */
playBtn?.addEventListener("click", ()=> {
  playerSim.classList.remove("hidden");
  buffer.classList.remove("hidden");
  // simulate buffering for 900ms then start
  setTimeout(()=> {
    buffer.classList.add("hidden");
    simVideo.play().catch(()=>{});
    playToggle.textContent = "Pause";
  }, 900);
});

playToggle?.addEventListener("click", ()=> {
  if (simVideo.paused) { simVideo.play(); playToggle.textContent = "Pause"; }
  else { simVideo.pause(); playToggle.textContent = "Play"; }
});
volumeEl?.addEventListener("input", ()=> {
  simVideo.volume = volumeEl.value;
});
simVideo?.addEventListener("timeupdate", ()=> {
  if (!simVideo.duration || !isFinite(simVideo.duration)) return;
  const pct = (simVideo.currentTime / simVideo.duration) * 100;
  timeline.value = pct;
});
timeline?.addEventListener("input", ()=> {
  const pct = Number(timeline.value)/100;
  if (simVideo.duration && isFinite(simVideo.duration)) {
    simVideo.currentTime = simVideo.duration * pct;
  }
});
subsToggle?.addEventListener("change", ()=> {
  // simulated subtitles toggle (we'll just show/hide a faux subtitle overlay)
  if (subsToggle.checked) {
    if (!qs(".fake-subs")) {
      const s = document.createElement("div");
      s.className = "fake-subs";
      s.style.position="absolute";
      s.style.bottom="12px";
      s.style.left="50%";
      s.style.transform="translateX(-50%)";
      s.style.background="rgba(0,0,0,0.4)";
      s.style.padding="6px 10px";
      s.style.borderRadius="6px";
      s.style.color="white";
      s.style.fontSize="14px";
      s.textContent="— Sample Subtitle On —";
      qs(".player-sim").appendChild(s);
    }
  } else {
    qs(".player-sim .fake-subs")?.remove();
  }
});

function createVidlinkUrl(tmdbId, media_type="movie", season=1, episode=1){
  if (!tmdbId) return "";
  // Use VidLink gateway per CRITICAL BACKEND SWAP: movie and tv embed templates
  if (media_type === "tv") return `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}`;
  return `https://vidlink.pro/movie/${tmdbId}`;
}

/* Inject an aggressive popup/interceptor guard on the host page.
   Ensure this is called immediately before inserting any third-party iframe. */
function ensurePopupInterceptor() {
  try {
    if (window.__abcPlayPopupInterceptorInstalled) return;
    window.__abcPlayPopupInterceptorInstalled = true;

    // Override window.open to trap unauthorized ad popups
    const originalWindowOpen = window.open;
    window.open = function(url, target, features) {
      try { console.warn("Blocked unauthorized popup attempt to:", url); } catch(e){}
      return null;
    };

    // Neutralize frame/top navigation hijacking attempts by attempting to stop navigation signals
    window.onbeforeunload = function() {
      setTimeout(() => { try { window.stop(); } catch(e){} }, 1);
    };

    // Intercept location APIs and watch for risky redirects containing ad/jump/next/pop/redirect
    const RISK_TERMS = ['jump','next','redirect','pop','ad','ads','click','track'];
    const checkUrl = (u) => {
      try {
        const s = String(u || '').toLowerCase();
        return RISK_TERMS.some(t => s.includes(t));
      } catch(e){ return false; }
    };

    const origAssign = window.location.assign;
    window.location.assign = function(u) {
      if (checkUrl(u)) { try { console.warn('Blocked risky navigation to', u); window.stop(); } catch(e){}; return; }
      return origAssign.call(this, u);
    };
    const origReplace = window.location.replace;
    window.location.replace = function(u) {
      if (checkUrl(u)) { try { console.warn('Blocked risky navigation to', u); window.stop(); } catch(e){}; return; }
      return origReplace.call(this, u);
    };

    // Also intercept direct setting attempts if possible (best-effort)
    try {
      const locProto = Object.getOwnPropertyDescriptor(Location.prototype, 'href');
      if (locProto && locProto.set) {
        const origSetter = locProto.set;
        Object.defineProperty(window.location, 'href', {
          set: function(val) {
            if (checkUrl(val)) { try { console.warn('Blocked risky href set to', val); window.stop(); } catch(e){}; return; }
            return origSetter.call(this, val);
          }
        });
      }
    } catch(e){ /* best-effort only */ }

    // Attempt to freeze navigation if an iframe tries to force top.location changes (best-effort)
    window.addEventListener('beforeunload', ()=>{ try{ window.stop(); } catch(e){} });

    // Ensure it's immutable attempt
    try {
      Object.defineProperty(window, 'open', { value: window.open, configurable: false, writable: false });
    } catch (e) {}

  } catch (e) {
    console.warn("Popup interceptor install failed", e);
  }
}

function closeModal(){
  modal.classList.add("hidden");
  playerSim.classList.add("hidden");
  // stop any video element if present (simulated trailer)
  const sim = qs("#simVideo");
  if (sim && sim.pause) try { sim.pause(); sim.currentTime = 0; } catch(e){}

  // STRICT: remove/destroy ALL iframe and video elements inside containers to force teardown
  const movieContainer = qs("#movieContainer");
  const trailerContainer = qs("#trailerContainer");

  // exact millisecond teardown: pause + destroy HLS + remove player node
  try {
    if (__abcCurrentPlayer) { try { __abcCurrentPlayer.pause(); } catch(e){}; __abcCurrentPlayer.remove(); __abcCurrentPlayer = null; }
    if (__abcCurrentHls) { try { __abcCurrentHls.destroy(); } catch(e){}; __abcCurrentHls = null; }
  } catch(e){}

  if (movieContainer) {
    movieContainer.innerHTML = "";
  }
  if (trailerContainer) {
    trailerContainer.innerHTML = "";
  }
  // also clear trailerWrap if legacy element exists
  const trailerWrap = qs("#trailerWrap");
  if (trailerWrap) trailerWrap.innerHTML = "";
}

/* ---- Initialize App ---- */
async function init(){
  await loadLandingSlides();
  await populateCarousels();

  // prepare hero title with first trending item if available
  // (use first carousel's first item)
  const firstCard = qs(".card img");
  if (firstCard) {
    qs("#heroTitle").textContent = "Now Showing";
    qs("#heroSubtitle").textContent = firstCard.alt || "Featured";
    // set hero background
    qs(".hero").style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,.5), transparent), url('${firstCard.src}')`;
    qs(".hero").style.backgroundSize = "cover";
    qs(".hero").style.backgroundPosition = "center";
  }

  // small UX: hide autocomplete when clicking outside
  document.addEventListener("click", (e)=>{
    const path = e.composedPath ? e.composedPath() : (e.path || []);
    if (!path.includes(autocomplete) && e.target !== searchInput) {
      autocomplete.classList.add("hidden");
    }
  });

  // ensure Authorization header is used for any fetch to TMDB (safeFetch wrapper uses fetch directly; we can patch global fetch usage for TMDB URLs)
  const _origFetch = window.fetch;
  window.fetch = function(input, init = {}) {
    try {
      const url = (typeof input === "string") ? input : input.url;
      if (url && url.includes("api.themoviedb.org")) {
        init = init || {};
        init.headers = Object.assign({}, init.headers || {}, { "Authorization": `Bearer ${TMDB_READ_TOKEN}` });
      }
    } catch (e) {}
    return _origFetch(input, init);
  };

  // Sign Up toast behavior
  const signupBtn = qs('#signupBtn');
  if (signupBtn) {
    signupBtn.addEventListener('click', ()=> {
      // create toast
      const toast = document.createElement('div');
      toast.className = 'signup-toast glass';
      toast.style.position = 'fixed';
      toast.style.right = '20px';
      toast.style.top = '84px';
      toast.style.zIndex = '9999';
      toast.style.padding = '12px 18px';
      toast.style.borderRadius = '12px';
      toast.style.display = 'flex';
      toast.style.alignItems = 'center';
      toast.style.gap = '12px';
      toast.style.boxShadow = '0 8px 30px rgba(0,0,0,.6)';
      toast.style.backdropFilter = 'blur(8px)';
      toast.style.opacity = '0';
      toast.style.transition = 'opacity .35s ease, transform .35s ease';
      toast.innerHTML = `<div style="font-size:20px;color:${'white'}">✅</div><div style="font-weight:700">Lucky you! No sign up required!</div>`;
      document.body.appendChild(toast);
      // animate in
      requestAnimationFrame(()=> {
        toast.style.opacity = '1';
        toast.style.transform = 'translateY(0)';
      });
      // fade out after 3s
      setTimeout(()=> {
        toast.style.opacity = '0';
        setTimeout(()=> { try { toast.remove(); } catch(e){} }, 400);
      }, 3000);
    });
  }

  // Intercept clicks early but only block suspicious outbound anchor links (do not freeze iframe/player controls)
  document.addEventListener('click', function(e){
    try {
      // If the click is on or within an anchor, evaluate it
      const targetLink = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!targetLink) return;

      const href = targetLink.href || '';
      // allow same-origin and known safe hosts
      const safeHosts = [window.location.hostname, 'tmdb.org', 'themoviedb.org', 'youtube.com', 'youtu.be'];
      const isExternal = href && !safeHosts.some(h => href.includes(h));

      // Block only when anchor intends to open a new tab or navigates offsite
      if (targetLink.target === '_blank' || isExternal) {
        e.preventDefault();
        e.stopPropagation();
        console.warn('NetworkShield: Blocked unauthorized ad popup link to:', href);
      }
      // otherwise, allow the click to proceed (no preventDefault) so iframe/player controls work
    } catch(err){}
  }, true);

  // open detail on double-clicking hero area (example)
  qs(".hero")?.addEventListener("dblclick", ()=> {
    const id = qs(".card")?.dataset?.id;
    const type = qs(".card")?.dataset?.type || 'movie';
    openDetail({ id, media_type: type }, qs(".card img")?.src || pickFallback(0));
  });
}

init();