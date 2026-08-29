/**
 * ==================================================================
 * SIRIUS GLOBAL — Main Application
 * Single-file modular architecture. Split by the FILE markers above
 * for multi-file deployment, or keep as one block for Tilda.
 * ==================================================================
 */
(function () {
  'use strict';

  /* --------------------------------------------------------------
     SECTION 1: CONFIGURATION
     Centralized constants — change once, apply everywhere.
  -------------------------------------------------------------- */
  const CONFIG = {
    MIN_DEPOSIT: 240,                          // USD / USDT
    DEPOSIT_WALLET: 'TQrz3nEZcbv8Q8Q2LJGRx9Q8uTP3cLaSYM',
    CURRENCY: 'USDT',
    NETWORK: 'TRC20',
    /** Backend API root (empty = same origin via Express). Set USE_BACKEND false for pure demo. */
    USE_BACKEND: true,
    API_BASE: '',
    WITHDRAW_FEE: 8.5,
    AVATARS: ['😊','🎯','💎','👑','🌟','🚀','💰','🏆'],
    // NOTE: sgPageMain (home/catalog) is intentionally NOT public.
    // Only the auth screen and static legal/info pages are reachable
    // before login — everything else hard-redirects to sgPageAuth.
    PUBLIC_PAGES: ['sgPageAuth','sgPagePrivacy','sgPageTerms','sgPageLicenses','sgPageFaq']
    // Per-property slider min/max/step live on each entry in PROPERTIES
    // below (sliderMin / sliderMax) rather than here, since every
    // property has its own investment range.
  };

  function injectAuthCodeFields() {
    const loginForm = document.getElementById('sgLoginForm');
    if (loginForm && !document.getElementById('loginInvite')) {
      const passGroup = loginForm.querySelector('#loginPass') && loginForm.querySelector('#loginPass').closest('.vb-input-group');
      const box = document.createElement('div');
      box.className = 'vb-input-group';
      box.innerHTML = '<label for="loginInvite">Access code (required)</label><input type="text" id="loginInvite" placeholder="ABC1" autocomplete="off" spellcheck="false" required><div class="t-input-error" id="loginInviteErr">Enter the one-time code linked to this account</div>';
      if (passGroup) loginForm.insertBefore(box, passGroup);
    }
    const regForm = document.getElementById('sgRegForm');
    if (regForm && !document.getElementById('regInvite')) {
      const passGroup = regForm.querySelector('#regPass') && regForm.querySelector('#regPass').closest('.vb-input-group');
      const box = document.createElement('div');
      box.className = 'vb-input-group';
      box.innerHTML = '<label for="regInvite">Registration code (required)</label><input type="text" id="regInvite" placeholder="ABC1" autocomplete="off" spellcheck="false" required><div class="t-input-error" id="regInviteErr">A valid one-time registration code from admin is required</div>';
      if (passGroup) regForm.insertBefore(box, passGroup);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectAuthCodeFields);
  else injectAuthCodeFields();

  const TOKEN_KEY = 'sg_auth_token';

  function apiUrl(path) {
    return (CONFIG.API_BASE || '') + path;
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(t) {
    try {
      if (t) localStorage.setItem(TOKEN_KEY, t);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) {}
  }

  function visitSessionId() {
    try {
      let id = localStorage.getItem('sg_visit_sid');
      if (!id) {
        id = 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('sg_visit_sid', id);
      }
      return id;
    } catch (e) { return 's_' + Date.now(); }
  }

  function isPublicIpStr(ip) {
    ip = String(ip || '').trim();
    if (!ip || ip === '127.0.0.1' || ip === '::1' || ip === '0.0.0.0' || ip === 'localhost') return false;
    if (ip.indexOf('10.') === 0 || ip.indexOf('192.168.') === 0 || ip.indexOf('169.254.') === 0) return false;
    const m = ip.match(/^172\.(\d+)\./);
    if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return false;
    return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || (ip.indexOf(':') !== -1 && ip.indexOf('fc') !== 0 && ip.indexOf('fd') !== 0);
  }

  async function detectPublicIp() {
    if (window.SGGeo) {
      const info = await window.SGGeo.detect();
      if (info && isPublicIpStr(info.ip)) {
        window.__sgPublicIp = info.ip;
        return info.ip;
      }
      const cur = window.SGGeo.current();
      if (cur && isPublicIpStr(cur.ip)) return cur.ip;
    }
    if (isPublicIpStr(window.__sgPublicIp)) return window.__sgPublicIp;
    return '';
  }

  async function visitorPayload() {
    let geo = null;
    try {
      if (window.SGGeo) geo = await window.SGGeo.detect();
    } catch (e) {}
    const clientIp = (geo && isPublicIpStr(geo.ip)) ? geo.ip : await detectPublicIp();
    return {
      clientIp: clientIp,
      clientCity: geo && geo.city ? geo.city : '',
      clientCountry: geo && geo.country ? geo.country : '',
      session: visitSessionId(),
      path: (location.pathname || '/') + (location.hash || '')
    };
  }

  async function trackVisit() {
    if (!CONFIG.USE_BACKEND) return;
    try {
      const payload = await visitorPayload();
      await apiFetch('/api/v1/track', { method: 'POST', body: JSON.stringify(payload) });
    } catch (e) {}
  }

  async function apiFetch(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ 'Content-Type': 'application/json', 'Accept': 'application/json' }, opts.headers || {});
    const token = getToken();
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(apiUrl(path), Object.assign({}, opts, { headers: headers }));
    } catch (netErr) {
      throw new Error('Network error — is the backend running?');
    }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      const msg = data.message || ('Request failed (' + res.status + ')');
      // Only force logout on explicit auth failure when already logged in AND path is not public
      if (res.status === 401 && STATE.isLoggedIn && path.indexOf('/auth/') === -1) {
        console.warn('API 401', path, msg);
      }
      throw new Error(msg);
    }
    return data;
  }


  /* --------------------------------------------------------------
     SECTION 2: APPLICATION STATE
     Single source of truth. Never mutated directly outside actions.
  -------------------------------------------------------------- */
  const STATE = {
    isLoggedIn: false,
    user: null,                // { name, email }
    confirmedBalance: 0,       // Only verified deposits increase this
    cart: [],                  // { type, id, name, amount, ... }
    portfolio: [],             // Owned shares: { id, name, amount, yield, purchasedAt, lastClaimAt }
    history: [],               // Transaction log
    pendingDeposits: [],       // Unverified deposit requests
    selectedAvatar: '😊',
    currentPropId: null,       // Which property modal is open
    bodyScrollTop: 0,          // Stored scroll position for modal lock
    sliderValues: {},          // { propId: currentSliderAmount } — live, per card
    reserved: {},               // { propId: amountReservedSoFar } — shared reservation pool per property
    galleryImages: [],          // Photos of the property currently open in the modal
    galleryIndex: 0,
    // Career license: { id, months, price, purchasedAt, expiresAt } | null
    license: null,
    // Share investment plan: { id, name, minInvest, maxInvest, price, purchasedAt } | null
    sharePlan: null
  };

  /* --------------------------------------------------------------
     LICENSE PACKAGES (career plan) — temporary, refunded on expiry
  -------------------------------------------------------------- */
  const LICENSE_PACKAGES = [
    {
      id: 'lic-1m',
      months: 1,
      price: 35,
      name: 'License — 1 Month',
      tag: 'Starter',
      desc: 'Career license for 1 month. Unlocks advanced platform tools. When the term ends, the full price is returned to your balance — renew anytime.'
    },
    {
      id: 'lic-3m',
      months: 3,
      price: 110,
      name: 'License — 3 Months',
      tag: 'Popular',
      desc: 'Career license for 3 months. Better value than the monthly rate. Full access for the whole term; funds are returned to your balance when it expires.'
    },
    {
      id: 'lic-6m',
      months: 6,
      price: 195,
      name: 'License — 6 Months',
      tag: 'Best value',
      desc: 'Career license for 6 months — maximum savings. After expiry, the full amount is credited back to your balance.'
    }
  ];

  /* --------------------------------------------------------------
     SHARE PLANS — permanent investment capacity tiers (upgrade only)
  -------------------------------------------------------------- */
  const SHARE_PLANS = [
    {
      id: 'plan-starter',
      name: 'Starter Plan',
      minInvest: 0,
      maxInvest: 5000,
      price: 35,
      tag: 'Entry',
      desc: 'Investment plan up to $5,000. Buy property shares within this limit. Stays forever — upgrade anytime.'
    },
    {
      id: 'plan-growth',
      name: 'Growth Plan',
      minInvest: 5000,
      maxInvest: 10000,
      price: 70,
      tag: 'Growth',
      desc: 'Plan from $5,000 to $10,000. More portfolio capacity. When upgrading, you only pay the difference from your current plan.'
    },
    {
      id: 'plan-pro',
      name: 'Pro Plan',
      minInvest: 10000,
      maxInvest: 20000,
      price: 140,
      tag: 'Pro',
      desc: 'Plan from $10,000 to $20,000. For active investors. Plans cannot be downgraded — only upgraded with a difference payment.'
    },
    {
      id: 'plan-elite',
      name: 'Elite Plan',
      minInvest: 20000,
      maxInvest: 100000,
      price: 240,
      tag: 'Elite',
      desc: 'Top tier: up to $100,000 in investments. Full capacity access. Permanent after purchase.'
    }
  ];

  /* --------------------------------------------------------------
     SECTION 3: PROPERTY DATA — real UAE real-estate style assets.
     Share prices from $170 (featured) then $1,000, $2,000, $3,000…
     Max 10 shares per purchase. Galleries use project photo set.
  -------------------------------------------------------------- */
  const IMG = {
    a: 'images/tild6662-6139-4130-a631-643032643564__photo-1708800843969-.jpg',
    b: 'images/tild3466-3939-4266-b637-306262623166__photo-1648647955520-.jpg',
    c: 'images/tild3165-6633-4434-a266-623338333736__photo-1737183616956-.jpg',
    d: 'images/tild3236-3838-4535-b861-613836353665__photo-1650435331525-.jpg',
    e: 'images/tild6463-6238-4762-a634-336339663532__photo-1624317937315-.jpg',
    f: 'images/tild3261-3733-4161-b163-333366326136__photo-1640877268187-.jpg',
    g: 'images/tild3861-6632-4538-b366-343035653838__photo-1735093333676-.jpg',
    h: 'images/tild6662-3733-4939-b139-343065313665__photo-1654520015092-.jpg',
    i: 'images/tild6637-3934-4436-b938-393264303361__photo-1666585607888-.jpg',
    j: 'images/tild3032-3031-4164-b162-323430386537__photo-1783497607905-.jpg'
  };

  const PROPERTIES = [
{
      id: 'majesty-geulunel',
      name: "M/Y Geulunel — Majesty 120",
      type: 'Superyacht',
      location: 'Dubai Marina / UAE waters',
      address: 'Dubai Marina, Dubai, UAE',
      mapQuery: 'Dubai Marina Yacht Club, Dubai, UAE',
      price: 250,
      totalValue: '$18,500,000',
      yield: 42,
      occupancy: 'Charter',
      image: 'images/yacht/main.jpg',
      gallery: [
        'images/yacht/outside.jpg',
        'images/yacht/outside-two.jpg',
        'images/yacht/inside-one.jpg',
        'images/yacht/inside-two.jpg',
        'images/yacht/inside-three.jpg',
        'images/yacht/main.jpg'
      ],
      videoUrl: 'images/yacht/main-video.mp4',
      streetView: null,
      desc: "M/Y 'Geulunel' is an immaculate superyacht designed for private getaways and effortless entertaining. Newly delivered in 2025, this powerful 37m Majesty 120 has been built with the owner's preferences in mind, with a strong focus on luxury, performance and comfort. Cruise and anchor in complete comfort with the addition of both Gyroscopic and Fin Stabilisation. Aggressive lines and a demanding profile define the Majesty 120, with the signature Majesty Yachts windows lining the hull. Extensive use of glass offers an unparalleled connection to the outdoors with low bulwarks allowing for an ornamental glass railing design. Amongst the standout features onboard the new Majesty 120 is a Jacuzzi situated on the sun deck. For optimal guest comfort, there are six cabins, including a full-beam master cabin on the main deck, a rare feature for super yachts of this length. This superyacht boasts 30% larger outdoor entertainment areas compared to any other yacht in its class. The smart layout onboard the Majesty 120 allows for a beachclub to double as a tender garage, creating a hybrid solution for the guests onboard. The multipurpose ladder that extends from the swim-platform allows for an easier and safer access to the superyacht while moored.",
      specs: { 'Length': '37 m (120 ft)', 'Model': 'Majesty 120', 'Year': '2025', 'Cabins': '6 (full-beam master)', 'Stabilisation': 'Gyro + Fin' }
    },
    {
      id: 'apt-dubailand',
      name: 'Dubailand Luxury Apartment',
      type: 'Apartment — Dubai',
      location: 'Dubailand, Dubai',
      address: 'Dubailand, Dubai, UAE',
      mapQuery: 'Dubailand, Dubai, United Arab Emirates',
      price: 170,
      totalValue: '$1,450,000',
      yield: 38,
      occupancy: 'Furnished',
      image: 'images/apt1/main.jpg',
      gallery: [
        'images/apt1/outside.jpg',
        'images/apt1/inside-four.jpg',
        'images/apt1/inside-one.jpg',
        'images/apt1/inside-three.jpg',
        'images/apt1/inside-two.jpg',
        'images/apt1/main.jpg'
      ],
      videoUrl: 'images/apt1/main-video.mp4',
      streetView: null,
      desc: 'Sirius Global Platform is proud to present this luxurious apartment located in the heart of Dubai. Offer a magnificent combination of comfortable living with luxurious, affordable units. From the harmonious continuity between interior and exterior aesthetics to the glamorous contemporary finishes enhanced by quality fixtures, you can be sure that it resonates the ultimate in a contemporary chic lifestyle. Rental Package Options: Cool Package - Furnished unit incl. Wi-Fi, chiller Cozy Package - Furnished unit incl. all bills Wi-Fi, chiller, DEWA (Electricity, water, etc.), and gas. Offer and Feature: • Furnished (Please note that the photo of the furniture provided is for illustrative purposes only). • Semi-open kitchen layout • Gas cooker and microwave oven • Shared swimming pool • Shared Gym • Children\'s play area • 24/7 Security • Well-maintained • Well managed The community mainly consists of apartment buildings that fall into the group of low to mid-rise. Its a district within Dubailand, situated on the outskirts of Dubai. The community is bordered by Al Barsha South towards the north and Sheikh Mohammed Bin Zayed Road towards the south. Further down south, there is Dubai Motor City, home to Dubai Autodrome..',
      specs: { 'Layout': 'Furnished apt', 'Kitchen': 'Semi-open', 'Amenities': 'Pool, Gym, Kids', 'Security': '24/7' }
    },
    {
      id: 'apt-difc-studio',
      name: 'DIFC Liberty House Studio',
      type: 'Studio — DIFC',
      location: 'DIFC, Dubai',
      address: 'Liberty House, DIFC, Dubai, UAE',
      mapQuery: 'Liberty House, DIFC, Dubai, UAE',
      price: 450,
      totalValue: '$1,050,000',
      yield: 40,
      occupancy: 'Move-in ready',
      image: 'images/apt2/main.jpg',
      gallery: [
        'images/apt2/outside.jpg',
        'images/apt2/inside-one.jpg',
        'images/apt2/inside-three.jpg',
        'images/apt2/inside-two.jpg',
        'images/apt2/main.jpg'
      ],
      videoUrl: 'images/apt2/main-video.mp4',
      streetView: null,
      desc: 'This fully furnished, move-in ready studio apartment is ideally located in the heart of Dubai International Financial Centre, offering both comfort and convenience. The apartment features a queen size bed, a cozy lounge area with sofas and a table, and a dedicated dining space. The fully equipped kitchen is finished to a high standard, with ample storage and built-in wardrobes throughout. The property also includes one allocated parking space and provides residents with access to health club facilities. Located in Liberty House, just behind Dusit Thani Dubai, the apartment is only minutes away from the metro, Sheikh Zayed Road, as well as a wide range of shops and restaurants. Call now to arrange a viewing. DIFC (Dubai International Financial Centre) is a federal free zone and Dubai\'s global, financial hub created in 2004 in order to promote the growth and development of financial services and related sectors within the UAE economy˜. This is a vibrant community in which to live and work with an extensive choice of restaurants on offer from cuisines from all over the world, art exhibitions and outlets, basic retail such as carpet sales, fitness and beauty services, convenience retail such as dry cleaners and tailors, supermarkets and mini marts and even a nursery, all connected through an underground tunnel enabling consumers and visitors to access all outlets on foot.',
      specs: { 'Layout': 'Studio', 'Parking': '1 allocated', 'Location': 'Behind Dusit Thani', 'Furnished': 'Yes' }
    },
    {
      id: 'apt-beachfront',
      name: 'Beachfront Luxury Apartment',
      type: 'Apartment — Dubai',
      location: 'Dubai coastline',
      address: 'Dubai, UAE',
      mapQuery: 'JBR The Walk, Dubai Marina, Dubai, UAE',
      price: 800,
      totalValue: '$2,800,000',
      yield: 36,
      occupancy: 'Premium',
      image: 'images/apt3/main.jpg',
      gallery: [
        'images/apt3/outside.jpg',
        'images/apt3/inside-four.jpg',
        'images/apt3/inside-one.jpg',
        'images/apt3/inside-three.jpg',
        'images/apt3/inside-two.jpg',
        'images/apt3/main.jpg'
      ],
      videoUrl: 'images/apt3/main-video.mp4',
      streetView: null,
      desc: 'Global Sirius Platform invites you to experience the pinnacle of beachfront luxury with this exquisite apartment in the iconic Address Beach Residences, Jumeirah Beach Residence. Featuring breathtaking views of the Arabian Gulf, Dubai Marina, and Bluewaters Island, this residence is ideal for those who appreciate stunning scenery and a vibrant waterfront lifestyle. Unit Features: -Fully Furnished - high end -Fully equipped kitchen – electric cooker -En-suite bedroom with king size and double twin size bed -Guest powder room -S2C type, 2 bedroom Sea View -With balcony Inclusions: -1 allocated parking slot -Once a week housekeeping services - including linen and towel change -Utility bills: DEWA, Chiller, and Internet -VAT and Municipality Fee Facilities and Offers: -Adults and Family Pools (Ground floor) -Fitness center -24 hours in-room dining service -24 hours Concierge service -Valet parking (charges apply) -Business center or meeting rooms -15% Discount at The Restaurant, The Lobby Lounge, Farina, Beach Grill -30% Discount on laundry and dry cleaning services -15% Discount on SPA treatments Located in one of Dubai’s most prestigious waterfront destinations, Address Beach Residences offers unparalleled convenience, luxury, and lifestyle.',
      specs: { 'Style': 'Beachfront', 'Finish': 'Luxury', 'Status': 'Ready' }
    },
    {
      id: 'apt-city-1br',
      name: 'Modern City 1-Bedroom',
      type: 'Apartment — Dubai',
      location: 'Dubai',
      address: 'Dubai, UAE',
      mapQuery: 'Business Bay Canal, Dubai, UAE',
      price: 1000,
      totalValue: '$1,250,000',
      yield: 37,
      occupancy: 'For rent',
      image: 'images/apt4/main.jpg',
      gallery: [
        'images/apt4/outside.jpg',
        'images/apt4/inside-four.jpg',
        'images/apt4/inside-one.jpg',
        'images/apt4/inside-three.jpg',
        'images/apt4/inside-two.jpg',
        'images/apt4/main.jpg'
      ],
      videoUrl: 'images/apt4/main-video.mp4',
      streetView: null,
      desc: 'Discover modern city living with this stylish 1-bedroom apartment, available now for rent. Perfectly located in the heart of Dubai, this home combines elegance, comfort, and a lifestyle surrounded by some of the most iconic landmarks in the city. The apartment offers a bright and spacious layout with floor-to-ceiling windows that frame the stunning Za’abeel views, creating a sense of openness and connection to the vibrant city beyond. Inside, the apartment is designed for both convenience and style. The open-plan living and dining space is enhanced with a TV, dining table, and chairs, making it ready for immediate use. The bedroom is cozy yet modern, with plenty of natural light, creating the perfect retreat after a long day. The apartment’s thoughtful design ensures a smooth blend of function and sophistication. Residents of benefit from access to premium amenities, including a swimming pool, fully equipped gym, multipurpose social spaces, and landscaped areas ideal for relaxation. The tower also enjoys direct connectivity to Dubai Mall via a link bridge, putting world-class shopping, dining, and entertainment just moments away. With its unbeatable location, modern furnishings, and breathtaking views, this apartment is the perfect choice for professionals or couples seeking a home in the center of Dubai’s dynamic lifestyle.',
      specs: { 'Layout': '1 BR', 'Style': 'Modern', 'Status': 'Available' }
    },
    {
      id: 'apt-passo',
      name: 'Passo by Beyond 1BR',
      type: 'Apartment — Dubai',
      location: 'Dubai',
      address: 'Passo by Beyond, Dubai, UAE',
      mapQuery: 'Palm Jumeirah Crescent, Dubai, UAE',
      price: 1350,
      totalValue: '$1,900,000',
      yield: 39,
      occupancy: 'Coastal',
      image: 'images/apt5/main.jpg',
      gallery: [
        'images/apt5/outside.jpg',
        'images/apt5/inside-four.jpg',
        'images/apt5/inside-one.jpg',
        'images/apt5/inside-three.jpg',
        'images/apt5/inside-two.jpg',
        'images/apt5/main.jpg'
      ],
      videoUrl: 'images/apt5/main-video.mp4',
      streetView: null,
      desc: 'Experience a new dimension of coastal luxury in this exquisitely designed 1-bedroom residence at Passo by Beyond, set on the prestigious Crescent of Palm Jumeirah — one of Dubai’s most iconic and sought-after addresses. This 877 sqft home is a masterclass in refined beachfront living, blending sculptural architecture, timeless interiors, and uninterrupted views of the Arabian Gulf and Dubai’s glittering skyline. Step into a flowing open-plan layout where high ceilings and expansive glazing fill every corner with natural light, blurring the line between indoors and out. The living and dining area extends seamlessly to a private terrace, offering the perfect setting for morning coffee with sea breezes or evening sunsets over the water. The gourmet kitchen is crafted with sophisticated finishes, integrated appliances, and elegant stone worktops, making it as functional as it is beautiful. The primary bedroom is a serene retreat, featuring soft textures, bespoke wardrobes, and spa-inspired ensuite bathroom adorned with refined stone finishes and warm neutral tones. A separate powder room, laundry space, and intuitive storage solutions complete the thoughtful design, ensuring both elegance and practicality. Residents enjoy private beach access, a 40m-wide white sand shoreline, resort-style pools, wellness pavilions, landscaped social decks, and curated spaces for leisure, work, and connection — all managed with the privacy and exclusivity of a high-end residential community. Just minutes from Atlantis The Royal, Nakheel Mall, and Dubai Marina, and within easy reach of Downtown Dubai and both airports, Passo offers an unmatched location that balances island tranquility with city convenience.',
      specs: { 'Layout': '1 BR', 'Community': 'Passo by Beyond', 'Style': 'Coastal luxury' }
    },
    {
      id: 'apt-waterfront-studio',
      name: 'Waterfront Studio Apartment',
      type: 'Studio — Dubai',
      location: 'Dubai',
      address: 'Dubai, UAE',
      mapQuery: 'Dubai Harbour, Dubai, UAE',
      price: 1550,
      totalValue: '$1,150,000',
      yield: 41,
      occupancy: 'Studio',
      image: 'images/apt6/main.jpg',
      gallery: [
        'images/apt6/outside.jpg',
        'images/apt6/inside-four.jpg',
        'images/apt6/inside-one.jpg',
        'images/apt6/inside-two.jpg',
        'images/apt6/main.jpg'
      ],
      videoUrl: 'images/apt6/main-video.mp4',
      streetView: null,
      desc: 'Sirius Global Platform proudly presents : Experience contemporary waterfront living in this elegant studio apartment, one of Dubai’s most sought-after lifestyle destinations. Designed with modern finishes and sophisticated interiors, this residence offers the perfect blend of comfort, style, and convenience, ideal for both end-users and investors. Property Features: • Spacious Studio Apartment • Contemporary Open Layout • Floor-to-Ceiling Windows • Premium Finishes and Fixtures • Modern Kitchen with High-Quality Cabinetry • Built-in Wardrobes • Elegant Bathroom • Balcony with Community/City Views • Central Air Conditioning • Dedicated Parking Space World-Class Amenities & Facilities: • Infinity Swimming Pool • State-of-the-Art Gymnasium • Outdoor Fitness Areas • Luxury Spa and Wellness Facilities • Yoga and Meditation Spaces • Landscaped Gardens • Children\'s Play Area • Leisure Deck and Sun Loungers • BBQ Area • Running Track • Cafés and Retail Outlets • 24/7 Security and Concierge Services • High-Speed Elevators • Covered Parking • Easy Access to Sheikh Zayed Road and Al Khail Road Prime Location: • Minutes from Downtown Dubai and Burj Khalifa • Close to Dubai Mall and Dubai Opera • Easy connectivity to DIFC and City Walk • Near restaurants, supermarkets, schools, and healthcare facilities • Convenient access to Dubai International Airport Its offer a distinctive lifestyle inspired by wellness and luxury, making it an exceptional choice for residents and investors seeking premium living in the heart of Dubai.',
      specs: { 'Layout': 'Studio open-plan', 'Windows': 'Floor-to-ceiling', 'Parking': 'Dedicated' }
    },
    {
      id: 'apt-marina-corner',
      name: 'Dubai Marina Corner Apartment',
      type: 'Apartment — Dubai Marina',
      location: 'Dubai Marina',
      address: 'Marina Promenade, Dubai Marina, UAE',
      mapQuery: 'Marina Promenade, Dubai Marina, Dubai, UAE',
      price: 1900,
      totalValue: '$2,400,000',
      yield: 38,
      occupancy: 'Vacant',
      image: 'images/apt7/main.jpg',
      gallery: [
        'images/apt7/outside.jpg',
        'images/apt7/inside-four.jpg',
        'images/apt7/inside-one.jpg',
        'images/apt7/inside-three.jpg',
        'images/apt7/inside-two.jpg',
        'images/apt7/main.jpg'
      ],
      videoUrl: 'images/apt7/main-video.mp4',
      streetView: null,
      desc: 'This property is currently vacant and ready for immediate occupancy. Property Features - Vacant Now - Spacious Layout - High Floor - Balcony - Partial Marina and Sea View - Corner Layout - Full Glass Windows - EMAAR Building - Quality Finishing - One Parking - Security - Gymnasium - Swimming Pool - Squash Courts Tower is located directly on Marina Promenade within walking distance of Marina Mall, JBR Beach and Bluewaters Island, creating the perfect central environment catering to different lifestyles with endless options on your doorstep. Dubai Marina is the largest man-made marina in the world, offering towering skyscrapers, waterfront apartments and a range of restaurants, shops and cafes making Dubai Marina the perfect destination.',
      specs: { 'Layout': 'Corner', 'View': 'Partial Marina & Sea', 'Developer': 'Emaar', 'Parking': '1' }
    },
    {
      id: 'apt-lagoon-1br',
      name: 'Beach Lagoon 1BR Investment',
      type: 'Apartment — Dubai',
      location: 'Dubai',
      address: 'Dubai beach lagoon community, UAE',
      mapQuery: 'Dubai Creek Harbour, Dubai, UAE',
      price: 2100,
      totalValue: '$1,100,000',
      yield: 35,
      occupancy: 'Tenanted to Apr 2027',
      image: 'images/apt8/main.jpg',
      gallery: [
        'images/apt8/outside.jpg',
        'images/apt8/inside-four.jpg',
        'images/apt8/inside-one.jpg',
        'images/apt8/inside-three.jpg',
        'images/apt8/inside-two.jpg',
        'images/apt8/main.jpg'
      ],
      videoUrl: 'images/apt8/main-video.mp4',
      streetView: null,
      desc: 'Property Highlights: - 1 Bedroom - 1 Bathroom - 675.87 sq.ft. - Beach Lagoon Access - Reference No. axc-3994647 - Property is rented till April 2027 - Best for investment Amenities: - Outdoor Play area - BBQ area - Fully Equipped Gym - Multipurpose room - Town Center - Community Pool and Kids Pool Make this property your new home. This family-oriented community is perfect for creating cherished memories and enjoying the peaceful rhythms of coastal living',
      specs: { 'Layout': '1 BR / 1 Bath', 'Area': '675.87 sq.ft', 'Access': 'Beach Lagoon', 'Investment': 'Tenanted' }
    },
{
      id: 'lake-view-villa',
      name: 'Lake View Villa — Type 4M',
      type: 'Villa',
      location: 'Dubai, UAE',
      address: 'Dubai, UAE',
      mapQuery: 'Jumeirah Golf Estates, Dubai, UAE',
      price: 2450,
      totalValue: '$2,850,000',
      yield: 36,
      occupancy: 'Vacant',
      image: 'images/villa1/main-outside.jpeg',
      gallery: [
        'images/villa1/outside.jpeg',
        'images/villa1/inside-one.jpeg',
        'images/villa1/inside-two.jpeg',
        'images/villa1/inside-three.jpeg',
        'images/villa1/inside-four.jpeg',
        'images/villa1/main-outside.jpeg'
      ],
      videoUrl: 'images/villa1/main-video.mp4',
      streetView: null,
      desc: 'Global Sirius Properties proudly presents: a two-bed spacious villa with a breathtaking lake view. Sunny and bright, with a fully upgraded kitchen. Two bedrooms on the first floor and a study on the ground floor. Separate laundry area, freshly painted, very peaceful location, super spacious. Three baths, pets allowed, neat and clean. Built-in wardrobes, extra guest parking, free pool access, 24/7 neighborhood security. Type 4M. Vacant and ready to move in. "Service you desire, people you trust" is the motto we live by. The driving ambition of Global Sirius Platform is to be recognized as a customer-centric real estate company. Our aim is to project ourselves as a dynamic, multi-dimensional, and a total-solution company that provides unparalleled real estate service to our clients. We provide a full range of real estate services including sales and leasing of residential/commercial properties and property management.',
      specs: { 'Layout': '2 BR + Study', 'Baths': '3', 'Type': '4M', 'Pool': 'Community access', 'Status': 'Vacant / Ready' }
    },
{
      id: 'al-barari-mansion',
      name: 'Al Barari Stand-Alone Mansion',
      type: 'Villa — Mansion',
      location: 'Al Barari, Dubai',
      address: 'Al Barari Phase 2, Dubai, UAE',
      mapQuery: 'Al Barari, Dubai, UAE',
      price: 2650,
      totalValue: '$22,000,000',
      yield: 33,
      occupancy: 'Exclusive',
      image: 'images/villa2/main.jpg',
      gallery: [
        'images/villa2/outside.jpg',
        'images/villa2/inside-one.jpg',
        'images/villa2/inside-two.jpg',
        'images/villa2/main.jpg'
      ],
      videoUrl: 'images/villa2/main-video.mp4',
      streetView: null,
      desc: "One of only 23 stand-alone mansions in Phase 2 of the beautifully developed community of Al Barari, this exceptional property offers the perfect balance of elegance, privacy, and modern design. 7 bedrooms, underground parking, 27,000 sq.ft BUA, private lift, lagoon and beach access, near sports complex, near library, Body Language Gym, Heart and Soul Spa. Surrounded by astounding natural beauty, residents will enjoy an atmosphere of peace, creativity, and luxury. Every detail of this mansion has been designed to deliver a truly bespoke lifestyle in one of Dubai's most prestigious communities.",
      specs: { 'Bedrooms': '7', 'BUA': '27,000 sq.ft', 'Parking': 'Underground', 'Lift': 'Private', 'Access': 'Lagoon & Beach' }
    },
    {
      id: "apt-barari-hills",
      name: "Barari Hills Residence",
      type: "Apartment \u2014 Majan",
      location: "Majan, Dubai",
      address: "Barari Hills Residence, Majan, Dubai, UAE",
      mapQuery: "Barari Hills Residence, Majan, Dubai, UAE",
      price: 3000,
      totalValue: "$1,250,000",
      yield: 37,
      occupancy: "Residence",
      image: "images/apt9/main.jpg",
      gallery: [
        'images/apt9/inside-four.jpg',
        'images/apt9/inside-one.jpg',
        'images/apt9/inside-three.jpg',
        'images/apt9/inside-two.jpg',
        'images/apt9/outside.jpg',
        'images/apt9/main.jpg'
      ],
      videoUrl: "images/apt9/main-video.mp4",
      streetView: null,
      desc: "Welcome to Barari Hills Residence, where luxury meets comfort in the heart of Majan community! This brand-new building offers a seamless blend of sophistication and convenience. These ready-to-move-in residences are crafted with premium quality and attention to detail. Why Barari Hills Residence? Ready to move in Spacious laundry storage area with closed kitchen 1 bedroom and 2 Bathrooms Entertainer's dream open concept living space Well Maintained fitness center 24-hour security for tranquility Clean, Covered and fixed parking space Rooftop swimming pool with a deck Dedicated and safe children's play area Outdoor cinema coming soon Controlled access Sweeping panoramic city views and Peaceful Community Park views Don't miss the opportunity to be a part of this exclusive community. Contact us today to schedule a viewing and make Barari Hills Residence your new home!",
      specs: { "Layout": "1 Bed \u00b7 2 Bath", "Kitchen": "Closed + laundry", "Amenities": "Rooftop pool, gym, kids", "Security": "24/7" }
    },
    {
      id: "apt-beach-vista",
      name: "Beach Vista 1 \u2014 Emaar Beachfront",
      type: "Apartment \u2014 Beachfront",
      location: "Emaar Beachfront, Dubai",
      address: "Beach Vista 1, Emaar Beachfront, Dubai, UAE",
      mapQuery: "Beach Vista 1, Emaar Beachfront, Dubai, UAE",
      price: 3200,
      totalValue: "$1,250,000",
      yield: 37,
      occupancy: "Residence",
      image: "images/apt10/main.jpg",
      gallery: [
        'images/apt10/inside-four.jpg',
        'images/apt10/inside-one.jpg',
        'images/apt10/inside-three.jpg',
        'images/apt10/inside-two.jpg',
        'images/apt10/outside.jpg',
        'images/apt10/main.jpg'
      ],
      videoUrl: "images/apt10/main-video.mp4",
      streetView: null,
      desc: "Largest floor plan in the building, offering a spacious reconfigured layout with a hotel-style master suite. Apartment Specs: - High floor with captivating views - Spacious living area with a bright ambiance - Full Palm Jumeirah Side sea view with unobstructed sunset orientation - the most sought-after sunset views. - Largest floor plan in the building reconfigured into a 2 bedroom layout with a hotel grade master suite. - High Spec Bespoke Renovations, fixtures and furniture by Bloom & Beyond Design. - Built in sound systems throughout the apartment - Direct access to Emaar Beachfronts 1.5km private beach, marina promenade and on-island F&B. Step into luxury living with this beautifully designed apartment featuring upgraded interiors and full amenities. The open-plan layout connects the living area to the fully fitted kitchen, perfect for entertaining. Enjoy the serenity of your private balcony, ideal for morning coffee or evening relaxation. Each bedroom boasts built-in wardrobes, with the master suite featuring a walk-in closet for added convenience. Beach Vista 1 provides access to a range of top-notch amenities, including a private pool, shared swimming pool, steam room, and private gym. Residents benefit from 24-hour concierge service and security staff, ensuring a safe and comfortable living environment. The property also features easy beach access and is conveniently located near public transport, making it an ideal choice for city living.",
      specs: { "Layout": "2 Bed hotel-style master", "View": "Palm Jumeirah sunset", "Amenities": "Private beach, gym, pools", "Interior": "Bloom & Beyond" }
    },
    {
      id: "apt-design-quarter",
      name: "Design Quarter Tower A",
      type: "Apartment \u2014 d3",
      location: "Dubai Design District",
      address: "Design Quarter Tower A, Dubai Design District, UAE",
      mapQuery: "Design Quarter Tower A, Dubai Design District, UAE",
      price: 3550,
      totalValue: "$1,250,000",
      yield: 37,
      occupancy: "Residence",
      image: "images/apt11/main.jpg",
      gallery: [
        'images/apt11/inside-four.jpg',
        'images/apt11/inside-one.jpg',
        'images/apt11/inside-three.jpg',
        'images/apt11/inside-two.jpg',
        'images/apt11/outside.jpg',
        'images/apt11/main.jpg'
      ],
      videoUrl: "images/apt11/main-video.mp4",
      streetView: null,
      desc: "Sirious Global Platform proudly presents this contemporary 2-bedroom apartment in Design Quarter, Tower A, located in the heart of Dubai \u2014 a vibrant urban community known for its modern architecture and creative atmosphere Design Quarter offers stylish residences with smart layouts and high-quality finishes, attracting professionals and end-users seeking a dynamic city lifestyle. This mid-floor apartment and benefits from excellent natural light and functional living spaces PROPERTY DETAILS \u2022 Design Quarter, Tower A \u2022 2-Bedroom Apartment \u2022 Total size 1,185 sqft / 110.04 sqm \u2022 Mid floor \u2022 Design District view \u2022 Modern layout AMENITIES \u2022 Swimming pool \u2022 Fully equipped gym \u2022 Landscaped podium areas \u2022 24/7 security \u2022 Covered parking \u2022 Retail outlets and cafes within the community It is a prime mixed-use destination located minutes from Downtown Dubai, DIFC, and Business Bay. Known for its walkable environment, contemporary lifestyle offerings, and strong long-term potential, d3 continues to be one of Dubai\u2019s most attractive urban residential locations.",
      specs: { "Layout": "2 Bed \u00b7 1,185 sqft", "Floor": "Mid floor", "View": "Design District", "Amenities": "Pool, gym, parking" }
    },
    {
      id: "apt-binghatti-skyrise",
      name: "Binghatti Skyrise \u2014 Business Bay",
      type: "Apartment \u2014 Business Bay",
      location: "Business Bay, Dubai",
      address: "Binghatti Skyrise, Business Bay, Dubai, UAE",
      mapQuery: "Binghatti Skyrise, Business Bay, Dubai, UAE",
      price: 3750,
      totalValue: "$1,250,000",
      yield: 37,
      occupancy: "Residence",
      image: "images/apt12/main.jpg",
      gallery: [
        'images/apt12/inside-one.jpg',
        'images/apt12/inside-three.jpg',
        'images/apt12/inside-two.jpg',
        'images/apt12/outside.jpg',
        'images/apt12/main.jpg'
      ],
      videoUrl: "images/apt12/main-video.mp4",
      streetView: null,
      desc: "Experience luxury waterfront living at Binghatti Skyrise, an iconic residential development in the heart of Business Bay, offering premium residences, exceptional amenities, and excellent investment potential. Property Highlights Completion: Q4 2027 Smart Home Technology Prime Business Bay Location High Rental Return Potential Luxury Lifestyle Community Prime Location 2 Minutes to Dubai Canal 3 Minutes to Burj Khalifa 3 Minutes to Dubai Mall 5 Minutes to Business Bay Marina 5 Minutes to Dubai Opera World-Class Amenities Infinity Swimming Pool Artificial Beach Indoor Gym Private Golf Area Tennis Court Paddle Court Jogging Track Skate Park Children's Play Area Landscaped Leisure Areas",
      specs: { "Completion": "Q4 2027", "Tech": "Smart home", "Location": "Business Bay canal", "Amenities": "Infinity pool, beach, gym" }
    },
    {
      id: "apt-mirdif-hills",
      name: "Mirdif Hills Duplex \u2014 Janayen Avenue",
      type: "Apartment \u2014 Mirdif",
      location: "Mirdif Hills, Dubai",
      address: "Janayen Avenue Block G, Mirdif Hills, Dubai, UAE",
      mapQuery: "Janayen Avenue Block G, Mirdif Hills, Dubai, UAE",
      price: 4100,
      totalValue: "$1,250,000",
      yield: 37,
      occupancy: "Residence",
      image: "images/apt13/main.jpg",
      gallery: [
        'images/apt13/inside-four.jpg',
        'images/apt13/inside-one.jpg',
        'images/apt13/inside-three.jpg',
        'images/apt13/inside-two.jpg',
        'images/apt13/main.jpg'
      ],
      videoUrl: "images/apt13/main-video.mp4",
      streetView: null,
      desc: "Discover a rare opportunity to own a luxury 4-bedroom duplex in Mirdif Hills with breathtaking, uninterrupted views of Mushrif Park. Professionally furnished by an interior designer, this exceptional residence in Janayen Avenue Block G combines elegant design, spacious living areas, and a premium location, making it ideal for both end-users and investors. Spanning an impressive 2,926 Sq. Ft. , this duplex offers a thoughtfully designed layout with expansive living and dining spaces, high-quality furnishings, and abundant natural light throughout. The unique park-facing position ensures lifetime open views, providing a serene and exclusive living experience. Property Details \u2022 4 Bedrooms + Maid's Room \u2022 Duplex Apartment \u2022 Fully Furnished by Professional Interior Designer \u2022 Facing Mushrif Park \u2022 Uninterrupted Lifetime Park Views \u2022 Size: 2,926 Sq. Ft. \u2022 Spacious Living and Dining Areas \u2022 Premium Finishes Throughout \u2022 Built-in Wardrobes \u2022 Modern Kitchen \u2022 Vacant on Transfer Key Highlights \u2022 Rare Duplex Layout \u2022 Fully Designer Furnished \u2022 Direct Views of Mushrif Park \u2022 Ideal Family Home \u2022 Excellent Investment Opportunity \u2022 Ready for Immediate Occupancy Upon Transfer Community Features \u2022 Located in Janayen Avenue, Mirdif Hills \u2022 Freehold Community \u2022 Swimming Pool and Gymnasium \u2022 24-Hour Security and Maintenance \u2022 Landscaped Community Areas \u2022 Children's Play Areas \u2022 Retail Outlets, Cafes, and Restaurants Nearby \u2022 Close to Mirdif City Centre \u2022 Easy Access to Sheikh Mohammed Bin Zayed Road \u2022 Minutes from Dubai International Airport",
      specs: { "Layout": "4 Bed duplex + maid", "Size": "2,926 sqft", "View": "Mushrif Park", "Status": "Designer furnished" }
    }
  ];

  // Derive a numeric full-value ceiling for each property (parsed from
  // its display string), max number of shares (capped at 10), and seed the pool.
  // Slider values store SHARE COUNT; dollar amount = shares * price.
  const MAX_SHARES_PER_PURCHASE = 10;
  PROPERTIES.forEach(p => {
    p.totalValueNum = parseInt(p.totalValue.replace(/[^0-9]/g, ''), 10) || 0;
    const byValue = Math.max(1, Math.floor(p.totalValueNum / p.price));
    p.maxShares = Math.min(MAX_SHARES_PER_PURCHASE, byValue);
    STATE.reserved[p.id] = 0;
    STATE.sliderValues[p.id] = 1; // default: 1 share
  });

  /* --------------------------------------------------------------
     SECTION 4: UTILITY FUNCTIONS
  -------------------------------------------------------------- */
  /** Show a transient toast notification at bottom center. */
  function showToast(msg) {
    let t = document.getElementById('sgToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'sgToast';
      t.style.cssText = 'position:fixed;bottom:28px;left:50%;transform:translateX(-50%) translateY(20px);background:#1a1f2e;border:1px solid rgba(201,169,110,0.3);color:#e8e4d9;padding:12px 24px;border-radius:10px;font-size:0.85rem;z-index:9999;opacity:0;transition:all 0.3s;pointer-events:none;font-family:Georgia,serif;max-width:90vw;text-align:center;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(t._tid);
    t._tid = setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2800);
  }

  /** Simple email format validator. */
  function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()); }

  /* Full country dial list (ISO, name, dial, national mask, flag). */
  const COUNTRY_DIALS = [
    {c:'AF',n:'Afghanistan',d:'+93',m:'XX XXX XXXX',f:'🇦🇫'},
    {c:'AL',n:'Albania',d:'+355',m:'XX XXX XXXX',f:'🇦🇱'},
    {c:'DZ',n:'Algeria',d:'+213',m:'XXX XX XX XX',f:'🇩🇿'},
    {c:'AD',n:'Andorra',d:'+376',m:'XXX XXX',f:'🇦🇩'},
    {c:'AO',n:'Angola',d:'+244',m:'XXX XXX XXX',f:'🇦🇴'},
    {c:'AG',n:'Antigua and Barbuda',d:'+1',m:'(XXX) XXX-XXXX',f:'🇦🇬'},
    {c:'AR',n:'Argentina',d:'+54',m:'XX XXXX-XXXX',f:'🇦🇷'},
    {c:'AM',n:'Armenia',d:'+374',m:'XX XXX XXX',f:'🇦🇲'},
    {c:'AU',n:'Australia',d:'+61',m:'XXX XXX XXX',f:'🇦🇺'},
    {c:'AT',n:'Austria',d:'+43',m:'XXX XXXXXXX',f:'🇦🇹'},
    {c:'AZ',n:'Azerbaijan',d:'+994',m:'XX XXX XX XX',f:'🇦🇿'},
    {c:'BS',n:'Bahamas',d:'+1',m:'(XXX) XXX-XXXX',f:'🇧🇸'},
    {c:'BH',n:'Bahrain',d:'+973',m:'XXXX XXXX',f:'🇧🇭'},
    {c:'BD',n:'Bangladesh',d:'+880',m:'XXXX-XXXXXX',f:'🇧🇩'},
    {c:'BB',n:'Barbados',d:'+1',m:'(XXX) XXX-XXXX',f:'🇧🇧'},
    {c:'BY',n:'Belarus',d:'+375',m:'(XX) XXX-XX-XX',f:'🇧🇾'},
    {c:'BE',n:'Belgium',d:'+32',m:'XXX XX XX XX',f:'🇧🇪'},
    {c:'BZ',n:'Belize',d:'+501',m:'XXX-XXXX',f:'🇧🇿'},
    {c:'BJ',n:'Benin',d:'+229',m:'XX XX XX XX',f:'🇧🇯'},
    {c:'BT',n:'Bhutan',d:'+975',m:'XX XXX XXX',f:'🇧🇹'},
    {c:'BO',n:'Bolivia',d:'+591',m:'XXXX XXXX',f:'🇧🇴'},
    {c:'BA',n:'Bosnia and Herzegovina',d:'+387',m:'XX XXX XXX',f:'🇧🇦'},
    {c:'BW',n:'Botswana',d:'+267',m:'XX XXX XXX',f:'🇧🇼'},
    {c:'BR',n:'Brazil',d:'+55',m:'(XX) XXXXX-XXXX',f:'🇧🇷'},
    {c:'BN',n:'Brunei',d:'+673',m:'XXX XXXX',f:'🇧🇳'},
    {c:'BG',n:'Bulgaria',d:'+359',m:'XXX XXX XXX',f:'🇧🇬'},
    {c:'BF',n:'Burkina Faso',d:'+226',m:'XX XX XX XX',f:'🇧🇫'},
    {c:'BI',n:'Burundi',d:'+257',m:'XX XX XX XX',f:'🇧🇮'},
    {c:'KH',n:'Cambodia',d:'+855',m:'XX XXX XXX',f:'🇰🇭'},
    {c:'CM',n:'Cameroon',d:'+237',m:'X XX XX XX XX',f:'🇨🇲'},
    {c:'CA',n:'Canada',d:'+1',m:'(XXX) XXX-XXXX',f:'🇨🇦'},
    {c:'CV',n:'Cape Verde',d:'+238',m:'XXX XX XX',f:'🇨🇻'},
    {c:'CF',n:'Central African Republic',d:'+236',m:'XX XX XX XX',f:'🇨🇫'},
    {c:'TD',n:'Chad',d:'+235',m:'XX XX XX XX',f:'🇹🇩'},
    {c:'CL',n:'Chile',d:'+56',m:'X XXXX XXXX',f:'🇨🇱'},
    {c:'CN',n:'China',d:'+86',m:'XXX XXXX XXXX',f:'🇨🇳'},
    {c:'CO',n:'Colombia',d:'+57',m:'XXX XXX XXXX',f:'🇨🇴'},
    {c:'KM',n:'Comoros',d:'+269',m:'XXX XXXX',f:'🇰🇲'},
    {c:'CG',n:'Congo',d:'+242',m:'XX XXX XXXX',f:'🇨🇬'},
    {c:'CD',n:'Congo (DRC)',d:'+243',m:'XXX XXX XXX',f:'🇨🇩'},
    {c:'CR',n:'Costa Rica',d:'+506',m:'XXXX XXXX',f:'🇨🇷'},
    {c:'HR',n:'Croatia',d:'+385',m:'XX XXX XXXX',f:'🇭🇷'},
    {c:'CU',n:'Cuba',d:'+53',m:'X XXX XXXX',f:'🇨🇺'},
    {c:'CY',n:'Cyprus',d:'+357',m:'XXXX XXXX',f:'🇨🇾'},
    {c:'CZ',n:'Czech Republic',d:'+420',m:'XXX XXX XXX',f:'🇨🇿'},
    {c:'DK',n:'Denmark',d:'+45',m:'XX XX XX XX',f:'🇩🇰'},
    {c:'DJ',n:'Djibouti',d:'+253',m:'XX XX XX XX',f:'🇩🇯'},
    {c:'DM',n:'Dominica',d:'+1',m:'(XXX) XXX-XXXX',f:'🇩🇲'},
    {c:'DO',n:'Dominican Republic',d:'+1',m:'(XXX) XXX-XXXX',f:'🇩🇴'},
    {c:'EC',n:'Ecuador',d:'+593',m:'XX XXX XXXX',f:'🇪🇨'},
    {c:'EG',n:'Egypt',d:'+20',m:'XX XXXX XXXX',f:'🇪🇬'},
    {c:'SV',n:'El Salvador',d:'+503',m:'XXXX XXXX',f:'🇸🇻'},
    {c:'GQ',n:'Equatorial Guinea',d:'+240',m:'XXX XXX XXX',f:'🇬🇶'},
    {c:'ER',n:'Eritrea',d:'+291',m:'X XXX XXX',f:'🇪🇷'},
    {c:'EE',n:'Estonia',d:'+372',m:'XXXX XXXX',f:'🇪🇪'},
    {c:'SZ',n:'Eswatini',d:'+268',m:'XXXX XXXX',f:'🇸🇿'},
    {c:'ET',n:'Ethiopia',d:'+251',m:'XX XXX XXXX',f:'🇪🇹'},
    {c:'FJ',n:'Fiji',d:'+679',m:'XXX XXXX',f:'🇫🇯'},
    {c:'FI',n:'Finland',d:'+358',m:'XX XXX XXXX',f:'🇫🇮'},
    {c:'FR',n:'France',d:'+33',m:'X XX XX XX XX',f:'🇫🇷'},
    {c:'GA',n:'Gabon',d:'+241',m:'X XX XX XX',f:'🇬🇦'},
    {c:'GM',n:'Gambia',d:'+220',m:'XXX XXXX',f:'🇬🇲'},
    {c:'GE',n:'Georgia',d:'+995',m:'XXX XX XX XX',f:'🇬🇪'},
    {c:'DE',n:'Germany',d:'+49',m:'XXX XXXXXXX',f:'🇩🇪'},
    {c:'GH',n:'Ghana',d:'+233',m:'XX XXX XXXX',f:'🇬🇭'},
    {c:'GR',n:'Greece',d:'+30',m:'XXX XXX XXXX',f:'🇬🇷'},
    {c:'GD',n:'Grenada',d:'+1',m:'(XXX) XXX-XXXX',f:'🇬🇩'},
    {c:'GT',n:'Guatemala',d:'+502',m:'XXXX XXXX',f:'🇬🇹'},
    {c:'GN',n:'Guinea',d:'+224',m:'XXX XX XX XX',f:'🇬🇳'},
    {c:'GW',n:'Guinea-Bissau',d:'+245',m:'XXX XXXX',f:'🇬🇼'},
    {c:'GY',n:'Guyana',d:'+592',m:'XXX XXXX',f:'🇬🇾'},
    {c:'HT',n:'Haiti',d:'+509',m:'XXXX XXXX',f:'🇭🇹'},
    {c:'HN',n:'Honduras',d:'+504',m:'XXXX-XXXX',f:'🇭🇳'},
    {c:'HK',n:'Hong Kong',d:'+852',m:'XXXX XXXX',f:'🇭🇰'},
    {c:'HU',n:'Hungary',d:'+36',m:'XX XXX XXXX',f:'🇭🇺'},
    {c:'IS',n:'Iceland',d:'+354',m:'XXX XXXX',f:'🇮🇸'},
    {c:'IN',n:'India',d:'+91',m:'XXXXX XXXXX',f:'🇮🇳'},
    {c:'ID',n:'Indonesia',d:'+62',m:'XXX-XXX-XXXX',f:'🇮🇩'},
    {c:'IR',n:'Iran',d:'+98',m:'XXX XXX XXXX',f:'🇮🇷'},
    {c:'IQ',n:'Iraq',d:'+964',m:'XXX XXX XXXX',f:'🇮🇶'},
    {c:'IE',n:'Ireland',d:'+353',m:'XX XXX XXXX',f:'🇮🇪'},
    {c:'IL',n:'Israel',d:'+972',m:'XX-XXX-XXXX',f:'🇮🇱'},
    {c:'IT',n:'Italy',d:'+39',m:'XXX XXX XXXX',f:'🇮🇹'},
    {c:'CI',n:'Ivory Coast',d:'+225',m:'XX XX XX XX XX',f:'🇨🇮'},
    {c:'JM',n:'Jamaica',d:'+1',m:'(XXX) XXX-XXXX',f:'🇯🇲'},
    {c:'JP',n:'Japan',d:'+81',m:'XX-XXXX-XXXX',f:'🇯🇵'},
    {c:'JO',n:'Jordan',d:'+962',m:'X XXXX XXXX',f:'🇯🇴'},
    {c:'KZ',n:'Kazakhstan',d:'+7',m:'(XXX) XXX-XX-XX',f:'🇰🇿'},
    {c:'KE',n:'Kenya',d:'+254',m:'XXX XXXXXX',f:'🇰🇪'},
    {c:'KW',n:'Kuwait',d:'+965',m:'XXXX XXXX',f:'🇰🇼'},
    {c:'KG',n:'Kyrgyzstan',d:'+996',m:'XXX XXX XXX',f:'🇰🇬'},
    {c:'LA',n:'Laos',d:'+856',m:'XX XX XXX XXX',f:'🇱🇦'},
    {c:'LV',n:'Latvia',d:'+371',m:'XXXX XXXX',f:'🇱🇻'},
    {c:'LB',n:'Lebanon',d:'+961',m:'XX XXX XXX',f:'🇱🇧'},
    {c:'LS',n:'Lesotho',d:'+266',m:'XXXX XXXX',f:'🇱🇸'},
    {c:'LR',n:'Liberia',d:'+231',m:'XX XXX XXXX',f:'🇱🇷'},
    {c:'LY',n:'Libya',d:'+218',m:'XX-XXXXXXX',f:'🇱🇾'},
    {c:'LI',n:'Liechtenstein',d:'+423',m:'XXX XX XX',f:'🇱🇮'},
    {c:'LT',n:'Lithuania',d:'+370',m:'XXX XXXXX',f:'🇱🇹'},
    {c:'LU',n:'Luxembourg',d:'+352',m:'XXX XXX XXX',f:'🇱🇺'},
    {c:'MO',n:'Macau',d:'+853',m:'XXXX XXXX',f:'🇲🇴'},
    {c:'MG',n:'Madagascar',d:'+261',m:'XX XX XXX XX',f:'🇲🇬'},
    {c:'MW',n:'Malawi',d:'+265',m:'X XXXX XXXX',f:'🇲🇼'},
    {c:'MY',n:'Malaysia',d:'+60',m:'XX-XXX XXXX',f:'🇲🇾'},
    {c:'MV',n:'Maldives',d:'+960',m:'XXX-XXXX',f:'🇲🇻'},
    {c:'ML',n:'Mali',d:'+223',m:'XX XX XX XX',f:'🇲🇱'},
    {c:'MT',n:'Malta',d:'+356',m:'XXXX XXXX',f:'🇲🇹'},
    {c:'MR',n:'Mauritania',d:'+222',m:'XXXX XXXX',f:'🇲🇷'},
    {c:'MU',n:'Mauritius',d:'+230',m:'XXXX XXXX',f:'🇲🇺'},
    {c:'MX',n:'Mexico',d:'+52',m:'XXX XXX XXXX',f:'🇲🇽'},
    {c:'MD',n:'Moldova',d:'+373',m:'XXXX XXXX',f:'🇲🇩'},
    {c:'MC',n:'Monaco',d:'+377',m:'XX XX XX XX',f:'🇲🇨'},
    {c:'MN',n:'Mongolia',d:'+976',m:'XXXX XXXX',f:'🇲🇳'},
    {c:'ME',n:'Montenegro',d:'+382',m:'XX XXX XXX',f:'🇲🇪'},
    {c:'MA',n:'Morocco',d:'+212',m:'XXX-XXXXXX',f:'🇲🇦'},
    {c:'MZ',n:'Mozambique',d:'+258',m:'XX XXX XXXX',f:'🇲🇿'},
    {c:'MM',n:'Myanmar',d:'+95',m:'X XXX XXXX',f:'🇲🇲'},
    {c:'NA',n:'Namibia',d:'+264',m:'XX XXX XXXX',f:'🇳🇦'},
    {c:'NP',n:'Nepal',d:'+977',m:'XXX-XXXXXXX',f:'🇳🇵'},
    {c:'NL',n:'Netherlands',d:'+31',m:'X XX XX XX XX',f:'🇳🇱'},
    {c:'NZ',n:'New Zealand',d:'+64',m:'XX XXX XXXX',f:'🇳🇿'},
    {c:'NI',n:'Nicaragua',d:'+505',m:'XXXX XXXX',f:'🇳🇮'},
    {c:'NE',n:'Niger',d:'+227',m:'XX XX XX XX',f:'🇳🇪'},
    {c:'NG',n:'Nigeria',d:'+234',m:'XXX XXX XXXX',f:'🇳🇬'},
    {c:'KP',n:'North Korea',d:'+850',m:'XXX XXX XXXX',f:'🇰🇵'},
    {c:'MK',n:'North Macedonia',d:'+389',m:'XX XXX XXX',f:'🇲🇰'},
    {c:'NO',n:'Norway',d:'+47',m:'XXX XX XXX',f:'🇳🇴'},
    {c:'OM',n:'Oman',d:'+968',m:'XXXX XXXX',f:'🇴🇲'},
    {c:'PK',n:'Pakistan',d:'+92',m:'XXX XXXXXXX',f:'🇵🇰'},
    {c:'PS',n:'Palestine',d:'+970',m:'XXX XXX XXX',f:'🇵🇸'},
    {c:'PA',n:'Panama',d:'+507',m:'XXXX-XXXX',f:'🇵🇦'},
    {c:'PG',n:'Papua New Guinea',d:'+675',m:'XXXX XXXX',f:'🇵🇬'},
    {c:'PY',n:'Paraguay',d:'+595',m:'XXX XXX XXX',f:'🇵🇾'},
    {c:'PE',n:'Peru',d:'+51',m:'XXX XXX XXX',f:'🇵🇪'},
    {c:'PH',n:'Philippines',d:'+63',m:'XXX XXX XXXX',f:'🇵🇭'},
    {c:'PL',n:'Poland',d:'+48',m:'XXX XXX XXX',f:'🇵🇱'},
    {c:'PT',n:'Portugal',d:'+351',m:'XXX XXX XXX',f:'🇵🇹'},
    {c:'QA',n:'Qatar',d:'+974',m:'XXXX XXXX',f:'🇶🇦'},
    {c:'RO',n:'Romania',d:'+40',m:'XXX XXX XXX',f:'🇷🇴'},
    {c:'RU',n:'Russia',d:'+7',m:'(XXX) XXX-XX-XX',f:'🇷🇺'},
    {c:'RW',n:'Rwanda',d:'+250',m:'XXX XXX XXX',f:'🇷🇼'},
    {c:'KN',n:'Saint Kitts and Nevis',d:'+1',m:'(XXX) XXX-XXXX',f:'🇰🇳'},
    {c:'LC',n:'Saint Lucia',d:'+1',m:'(XXX) XXX-XXXX',f:'🇱🇨'},
    {c:'VC',n:'Saint Vincent',d:'+1',m:'(XXX) XXX-XXXX',f:'🇻🇨'},
    {c:'WS',n:'Samoa',d:'+685',m:'XX XXX',f:'🇼🇸'},
    {c:'SM',n:'San Marino',d:'+378',m:'XXXX XXXXXX',f:'🇸🇲'},
    {c:'ST',n:'Sao Tome and Principe',d:'+239',m:'XXX XXXX',f:'🇸🇹'},
    {c:'SA',n:'Saudi Arabia',d:'+966',m:'XX XXX XXXX',f:'🇸🇦'},
    {c:'SN',n:'Senegal',d:'+221',m:'XX XXX XX XX',f:'🇸🇳'},
    {c:'RS',n:'Serbia',d:'+381',m:'XX XXX XXXX',f:'🇷🇸'},
    {c:'SC',n:'Seychelles',d:'+248',m:'X XX XX XX',f:'🇸🇨'},
    {c:'SL',n:'Sierra Leone',d:'+232',m:'XX XXXXXX',f:'🇸🇱'},
    {c:'SG',n:'Singapore',d:'+65',m:'XXXX XXXX',f:'🇸🇬'},
    {c:'SK',n:'Slovakia',d:'+421',m:'XXX XXX XXX',f:'🇸🇰'},
    {c:'SI',n:'Slovenia',d:'+386',m:'XX XXX XXX',f:'🇸🇮'},
    {c:'SB',n:'Solomon Islands',d:'+677',m:'XXXXX',f:'🇸🇧'},
    {c:'SO',n:'Somalia',d:'+252',m:'XX XXX XXX',f:'🇸🇴'},
    {c:'ZA',n:'South Africa',d:'+27',m:'XX XXX XXXX',f:'🇿🇦'},
    {c:'KR',n:'South Korea',d:'+82',m:'XX-XXXX-XXXX',f:'🇰🇷'},
    {c:'SS',n:'South Sudan',d:'+211',m:'XXX XXX XXX',f:'🇸🇸'},
    {c:'ES',n:'Spain',d:'+34',m:'XXX XX XX XX',f:'🇪🇸'},
    {c:'LK',n:'Sri Lanka',d:'+94',m:'XX XXX XXXX',f:'🇱🇰'},
    {c:'SD',n:'Sudan',d:'+249',m:'XX XXX XXXX',f:'🇸🇩'},
    {c:'SR',n:'Suriname',d:'+597',m:'XXX-XXXX',f:'🇸🇷'},
    {c:'SE',n:'Sweden',d:'+46',m:'XX-XXX XX XX',f:'🇸🇪'},
    {c:'CH',n:'Switzerland',d:'+41',m:'XX XXX XX XX',f:'🇨🇭'},
    {c:'SY',n:'Syria',d:'+963',m:'XXX XXX XXX',f:'🇸🇾'},
    {c:'TW',n:'Taiwan',d:'+886',m:'XXXX XXX XXX',f:'🇹🇼'},
    {c:'TJ',n:'Tajikistan',d:'+992',m:'XX XXX XXXX',f:'🇹🇯'},
    {c:'TZ',n:'Tanzania',d:'+255',m:'XXX XXX XXX',f:'🇹🇿'},
    {c:'TH',n:'Thailand',d:'+66',m:'X XXXX XXXX',f:'🇹🇭'},
    {c:'TL',n:'Timor-Leste',d:'+670',m:'XXXX XXXX',f:'🇹🇱'},
    {c:'TG',n:'Togo',d:'+228',m:'XX XX XX XX',f:'🇹🇬'},
    {c:'TO',n:'Tonga',d:'+676',m:'XXXXX',f:'🇹🇴'},
    {c:'TT',n:'Trinidad and Tobago',d:'+1',m:'(XXX) XXX-XXXX',f:'🇹🇹'},
    {c:'TN',n:'Tunisia',d:'+216',m:'XX XXX XXX',f:'🇹🇳'},
    {c:'TR',n:'Turkey',d:'+90',m:'XXX XXX XX XX',f:'🇹🇷'},
    {c:'TM',n:'Turkmenistan',d:'+993',m:'XX XXXXXX',f:'🇹🇲'},
    {c:'UG',n:'Uganda',d:'+256',m:'XXX XXXXXX',f:'🇺🇬'},
    {c:'UA',n:'Ukraine',d:'+380',m:'XX XXX XX XX',f:'🇺🇦'},
    {c:'AE',n:'United Arab Emirates',d:'+971',m:'XX XXX XXXX',f:'🇦🇪'},
    {c:'GB',n:'United Kingdom',d:'+44',m:'XXXX XXXXXX',f:'🇬🇧'},
    {c:'US',n:'United States',d:'+1',m:'(XXX) XXX-XXXX',f:'🇺🇸'},
    {c:'UY',n:'Uruguay',d:'+598',m:'XXXX XXXX',f:'🇺🇾'},
    {c:'UZ',n:'Uzbekistan',d:'+998',m:'XX XXX XX XX',f:'🇺🇿'},
    {c:'VU',n:'Vanuatu',d:'+678',m:'XXXXX',f:'🇻🇺'},
    {c:'VA',n:'Vatican City',d:'+39',m:'XXX XXX XXXX',f:'🇻🇦'},
    {c:'VE',n:'Venezuela',d:'+58',m:'XXX-XXXXXXX',f:'🇻🇪'},
    {c:'VN',n:'Vietnam',d:'+84',m:'XXX XXX XXXX',f:'🇻🇳'},
    {c:'YE',n:'Yemen',d:'+967',m:'XXX XXX XXX',f:'🇾🇪'},
    {c:'ZM',n:'Zambia',d:'+260',m:'XX XXX XXXX',f:'🇿🇲'},
    {c:'ZW',n:'Zimbabwe',d:'+263',m:'XX XXX XXXX',f:'🇿🇼'}
  ];

  /** Populate country code select (default UAE). */
  function populateCountrySelect() {
    const sel = document.getElementById('regPhoneCountry');
    if (!sel) return;
    const sorted = COUNTRY_DIALS.slice().sort(function (a, b) { return a.n.localeCompare(b.n); });
    sel.innerHTML = sorted.map(function (x) {
      return '<option value="' + x.c + '" data-dial="' + x.d + '" data-mask="' + x.m + '" data-flag="' + x.f + '"' +
        (x.c === 'AE' ? ' selected' : '') + '>' + x.f + ' ' + x.n + ' (' + x.d + ')</option>';
    }).join('');
  }

  /** Digits required by current country mask (count of X). */
  function phoneMaskMeta() {
    const sel = document.getElementById('regPhoneCountry');
    if (!sel || !sel.options.length) return { dial: '+971', mask: 'XX XXX XXXX', flag: '🇦🇪' };
    const opt = sel.options[sel.selectedIndex] || sel.options[0];
    return {
      dial: opt.getAttribute('data-dial') || '+971',
      mask: opt.getAttribute('data-mask') || 'XX XXX XXXX',
      flag: opt.getAttribute('data-flag') || ''
    };
  }

  function phoneDigitCountRequired() {
    return (phoneMaskMeta().mask.match(/X/g) || []).length;
  }

  /** Apply mask pattern: X = digit placeholder. */
  function applyPhoneMask(digits, mask) {
    let di = 0;
    let out = '';
    for (let i = 0; i < mask.length; i++) {
      if (mask[i] === 'X') {
        if (di >= digits.length) break;
        out += digits[di++];
      } else {
        if (di === 0 && mask[i] !== 'X') continue;
        if (di >= digits.length) break;
        out += mask[i];
      }
    }
    return out;
  }

  function formatRegPhoneInput() {
    const input = document.getElementById('regPhone');
    if (!input) return;
    const meta = phoneMaskMeta();
    const digits = input.value.replace(/\D/g, '').slice(0, phoneDigitCountRequired());
    input.value = applyPhoneMask(digits, meta.mask);
    input.placeholder = meta.mask.replace(/X/g, '0');
    validatePhoneField(false);
  }

  function isPhoneValid() {
    const input = document.getElementById('regPhone');
    if (!input) return false;
    const digits = input.value.replace(/\D/g, '');
    return digits.length >= phoneDigitCountRequired();
  }

  function getFullPhoneE164() {
    const meta = phoneMaskMeta();
    const input = document.getElementById('regPhone');
    const digits = (input ? input.value : '').replace(/\D/g, '');
    return meta.dial + digits;
  }

  /** Password strength: 0 weak, 1 medium, 2 strong */
  function passwordStrength(pass) {
    let score = 0;
    if (pass.length >= 8) score++;
    if (pass.length >= 12) score++;
    if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score++;
    if (/\d/.test(pass)) score++;
    if (/[^A-Za-z0-9]/.test(pass)) score++;
    if (score <= 2) return 0;
    if (score <= 3) return 1;
    return 2;
  }

  function updatePasswordMeter() {
    const pass = (document.getElementById('regPass') || {}).value || '';
    const fill = document.getElementById('regPassFill');
    const label = document.getElementById('regPassLabel');
    if (!fill || !label) return;
    fill.classList.remove('is-weak', 'is-medium', 'is-strong');
    label.classList.remove('is-weak', 'is-medium', 'is-strong');
    if (!pass) {
      fill.style.width = '0%';
      label.textContent = 'Password strength';
      return;
    }
    const level = passwordStrength(pass);
    const map = [
      { cls: 'is-weak', text: 'Weak — add length, numbers or symbols' },
      { cls: 'is-medium', text: 'Medium — almost there' },
      { cls: 'is-strong', text: 'Strong password' }
    ];
    fill.classList.add(map[level].cls);
    label.classList.add(map[level].cls);
    label.textContent = map[level].text;
  }

  function markField(el, valid) {
    if (!el) return;
    el.classList.toggle('is-valid', !!valid);
    el.classList.toggle('is-invalid', valid === false);
  }

  function validateEmailField(id, errId, showErr) {
    const el = document.getElementById(id);
    const ok = isEmail(el.value);
    markField(el, el.value ? ok : null);
    if (showErr) setErr(errId, !ok);
    return ok;
  }

  function validatePhoneField(showErr) {
    const el = document.getElementById('regPhone');
    const ok = isPhoneValid();
    markField(el, el.value ? ok : null);
    if (showErr) setErr('regPhoneErr', !ok);
    return ok;
  }

  function validatePassField(id, errId, minLen, showErr) {
    const el = document.getElementById(id);
    const ok = el.value.length >= minLen;
    markField(el, el.value ? ok : null);
    if (showErr) setErr(errId, !ok);
    return ok;
  }

  /** Toggle visibility of an error message element. */
  function setErr(id, show) { document.getElementById(id).classList.toggle('is-visible', show); }
  /** Hide all form error messages. */
  function clearErrs() { document.querySelectorAll('.t-input-error').forEach(e => e.classList.remove('is-visible')); }

  /* --------------------------------------------------------------
     SECTION 5: NAVIGATION & ROUTING
  -------------------------------------------------------------- */
  /** Switch visible page. Resets scroll. */
  function showPage(id) {
    document.querySelectorAll('.sg-page').forEach(p => p.classList.remove('active'));
    const pg = document.getElementById(id);
    if (pg) pg.classList.add('active');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    document.querySelectorAll('[data-nav]').forEach(a => {
      a.classList.toggle('active', a.dataset.nav === id);
    });
    // Keep portfolio timers up to date when entering cabinet
    if (STATE.isLoggedIn && id !== 'sgPageAuth') localStorage.setItem('sg_last_page', id);
    if (id === 'sgPageCabinet') renderPortfolioUI();
    if (id === 'sgPageMain') { renderPlansUI(); checkLicenseExpiry(); }
  }

  /** Guard: redirect unauthenticated users to auth page. */
  function gotoSecure(id) {
    if (!STATE.isLoggedIn) {
      alert('Please sign in or register first.');
      showPage('sgPageAuth');
      return;
    }
    showPage(id);
  }

  /* --------------------------------------------------------------
     SECTION 6: MODAL SYSTEM (with scroll lock)
  -------------------------------------------------------------- */
  /** Lock body scroll so only the modal can scroll. */
  function lockBodyScroll() {
    STATE.bodyScrollTop = window.scrollY || window.pageYOffset;
    document.body.classList.add('sg-body-no-scroll');
    document.body.style.top = '-' + STATE.bodyScrollTop + 'px';
  }

  /** Restore body scroll to exact previous position. */
  function unlockBodyScroll() {
    document.body.classList.remove('sg-body-no-scroll');
    document.body.style.top = '';
    window.scrollTo(0, STATE.bodyScrollTop);
  }

  /** Open a modal by ID and freeze background. */
  function openModal(id) {
    lockBodyScroll();
    document.getElementById('sgOverlay').classList.add('open');
    document.getElementById(id).classList.add('open');
  }

  /** Close all modals and restore scroll. */
  function closeAllModals() {
    unlockBodyScroll();
    document.getElementById('sgOverlay').classList.remove('open');
    document.querySelectorAll('.sg-modal').forEach(m => m.classList.remove('open'));
    // Stop any playing video by clearing the iframe container
    const vw = document.getElementById('sgPmVideoWrap');
    if (vw) vw.innerHTML = '';
  }

  /** Trap wheel events inside modal boundaries so they don't leak to body. */
  document.querySelectorAll('.sg-modal').forEach(modal => {
    modal.addEventListener('wheel', function(e) {
      const atTop = modal.scrollTop <= 0;
      const atBottom = modal.scrollTop + modal.clientHeight >= modal.scrollHeight - 1;
      if ((e.deltaY < 0 && atTop) || (e.deltaY > 0 && atBottom)) {
        e.preventDefault();
      }
    }, { passive: false });
  });

  /** Render the gallery carousel: main image, arrows, dots, counter, thumbnail strip. */
  function renderGallery(images, altName) {
    STATE.galleryImages = images;
    STATE.galleryIndex = 0;
    document.getElementById('sgPmGalleryMainImg').alt = altName;

    const dots = document.getElementById('sgPmGalleryDots');
    dots.innerHTML = images.map((_, i) =>
      `<button type="button" class="sg-prop__gallery-dot${i === 0 ? ' active' : ''}" data-gallery-dot="${i}" aria-label="Photo ${i+1}"></button>`
    ).join('');
    dots.style.display = images.length > 1 ? 'flex' : 'none';

    const thumbs = document.getElementById('sgPmGalleryThumbs');
    thumbs.innerHTML = images.map((src, i) =>
      `<div class="sg-prop__gallery-thumb${i === 0 ? ' active' : ''}" data-gallery-thumb="${i}"><img src="${src}" alt="${altName} photo ${i+1}" loading="lazy"></div>`
    ).join('');
    thumbs.style.display = images.length > 1 ? 'flex' : 'none';

    const arrows = images.length > 1;
    document.getElementById('sgPmGalleryPrev').style.display = arrows ? 'flex' : 'none';
    document.getElementById('sgPmGalleryNext').style.display = arrows ? 'flex' : 'none';

    goToGalleryIndex(0);
  }

  /** Switch the carousel to a given photo index, updating main image, dots, thumbs, counter. */
  function goToGalleryIndex(idx) {
    const images = STATE.galleryImages || [];
    if (!images.length) return;
    const n = images.length;
    STATE.galleryIndex = ((idx % n) + n) % n; // wrap around both directions

    document.getElementById('sgPmGalleryMainImg').src = images[STATE.galleryIndex];
    document.getElementById('sgPmGalleryCounter').textContent = `${STATE.galleryIndex + 1} / ${n}`;

    document.querySelectorAll('[data-gallery-dot]').forEach(d =>
      d.classList.toggle('active', Number(d.dataset.galleryDot) === STATE.galleryIndex));
    document.querySelectorAll('[data-gallery-thumb]').forEach(t =>
      t.classList.toggle('active', Number(t.dataset.galleryThumb) === STATE.galleryIndex));
  }

  /* --------------------------------------------------------------
     SECTION 7: PROPERTY CARD RENDERING
  -------------------------------------------------------------- */
  /** Amount of a property still available for reservation. */
  function remainingCapacity(p) {
    return Math.max(0, p.totalValueNum - STATE.reserved[p.id]);
  }

  /** Non-compounding linear projection: day / week / 12-month income for a given invested amount. */
  function projectReturns(amount, annualYieldPct) {
    const annual = amount * (annualYieldPct / 100);
    return {
      day: annual / 365,
      week: annual / 52,
      year: annual
    };
  }

  function fmtMoney(n) {
    if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (n >= 10) return '$' + n.toFixed(1);
    if (n >= 1) return '$' + n.toFixed(2);
    return '$' + n.toFixed(4); // small daily/weekly amounts
  }

  /** Render the horizontal property carousel. */
  function renderCards() {
    const track = document.getElementById('sgPropsTrack');
    track.innerHTML = '';
    PROPERTIES.forEach(p => {
      const card = document.createElement('div');
      card.className = 'sg-props__card';
      card.dataset.propId = p.id;
      card.innerHTML = `
        <div class="sg-props__card-imgwrap"> <img class="sg-props__card-img" src="${p.image}" alt="${p.name}" loading="lazy"> </div>
        <div class="sg-props__card-body">
          <div class="sg-props__card-type">${p.type}</div>
          <h3 class="sg-props__card-title">${p.name}</h3>
          <p class="sg-props__card-desc">${p.desc.substring(0,100)}…</p>
          <div class="sg-props__card-meta">
            <span class="sg-props__card-price">$${p.price} / share</span>
            <span class="sg-props__card-income">+${p.yield}% annual</span>
          </div>

          <div class="sg-invest" data-invest-block="${p.id}">
            <div class="sg-invest__row">
              <span class="sg-invest__label">Shares · Investment</span>
              <span class="sg-invest__amount" data-amount-label="${p.id}">1 × $${p.price}</span>
            </div>
            <input type="range" class="sg-invest__slider" data-slider-id="${p.id}"
              min="1" max="${p.maxShares}" step="1"
              value="${STATE.sliderValues[p.id]}">
            <div class="sg-invest__minmax"><span>1 share</span><span>${p.maxShares.toLocaleString('en-US')} shares</span></div>

            <div class="sg-invest__chart" data-chart="${p.id}">
              <div class="sg-invest__bar-wrap">
                <div class="sg-invest__bar-val" data-bar-val="day">$0</div>
                <div class="sg-invest__bar" data-bar="day" style="height:2px;"></div>
                <div class="sg-invest__bar-label">1 Day</div>
              </div>
              <div class="sg-invest__bar-wrap">
                <div class="sg-invest__bar-val" data-bar-val="week">$0</div>
                <div class="sg-invest__bar" data-bar="week" style="height:2px;"></div>
                <div class="sg-invest__bar-label">1 Week</div>
              </div>
              <div class="sg-invest__bar-wrap">
                <div class="sg-invest__bar-val" data-bar-val="year">$0</div>
                <div class="sg-invest__bar" data-bar="year" style="height:2px;"></div>
                <div class="sg-invest__bar-label">12 Months</div>
              </div>
            </div>
            <div class="sg-invest__progress-row">
              <span data-reserved-label="${p.id}">$0 reserved</span>
              <span data-remaining-label="${p.id}">of ${p.totalValue}</span>
            </div>
            <div class="sg-invest__progress-track">
              <div class="sg-invest__progress-fill" data-progress-fill="${p.id}" style="width:0%;"></div>
            </div>

            <button class="sg-invest__buy-btn" type="button" data-buy-id="${p.id}">Buy this amount</button>
          </div>

          <div class="sg-props__card-detail">Click card for full details &amp; virtual tour →</div>
        </div>`;
      track.appendChild(card);
    });
    PROPERTIES.forEach(p => { updateChartAndAmount(p.id); updateProgressUI(p.id); });
  }

  /** Dollar amount for current share selection on a property. */
  function amountFromShares(id) {
    const p = PROPERTIES.find(x => x.id === id);
    if (!p) return 0;
    const shares = STATE.sliderValues[id] || 1;
    return shares * p.price;
  }

  /** Recompute the amount label + projection chart for one property's card, from its share count. */
  function updateChartAndAmount(id) {
    const p = PROPERTIES.find(x => x.id === id);
    if (!p) return;
    const shares = STATE.sliderValues[id] || 1;
    const amount = shares * p.price;

    const amountLabel = document.querySelector(`[data-amount-label="${id}"]`);
    if (amountLabel) {
      amountLabel.textContent = shares === 1
        ? `1 × $${p.price}`
        : `${shares.toLocaleString('en-US')} × $${p.price} = ${fmtMoney(amount)}`;
    }

    const proj = projectReturns(amount, p.yield);
    const maxVal = Math.max(proj.day, proj.week, proj.year, 0.01);
    ['day','week','year'].forEach(k => {
      const bar = document.querySelector(`[data-chart="${id}"] [data-bar="${k}"]`);
      const val = document.querySelector(`[data-chart="${id}"] [data-bar-val="${k}"]`);
      if (bar) bar.style.height = Math.max(3, Math.round((proj[k] / maxVal) * 68)) + 'px';
      if (val) val.textContent = fmtMoney(proj[k]);
    });
  }

  /** Refresh the reservation progress bar + buy/slider disabled state for one property. */
  function updateProgressUI(id) {
    const p = PROPERTIES.find(x => x.id === id);
    if (!p) return;
    const reserved = STATE.reserved[id];
    const pct = Math.min(100, (reserved / p.totalValueNum) * 100);
    const remaining = remainingCapacity(p);
    const remainingShares = Math.max(0, Math.floor(remaining / p.price));

    const fill = document.querySelector(`[data-progress-fill="${id}"]`);
    if (fill) { fill.style.width = pct.toFixed(1) + '%'; fill.classList.toggle('full', remaining <= 0); }

    const reservedLabel = document.querySelector(`[data-reserved-label="${id}"]`);
    if (reservedLabel) reservedLabel.textContent = `${fmtMoney(reserved)} reserved (${pct.toFixed(0)}%)`;

    const slider = document.querySelector(`[data-slider-id="${id}"]`);
    const buyBtn = document.querySelector(`[data-buy-id="${id}"]`);

    if (remainingShares <= 0) {
      if (slider) slider.disabled = true;
      if (buyBtn) {
        buyBtn.disabled = true;
        buyBtn.classList.add('sold-out');
        buyBtn.textContent = 'Fully Reserved';
      }
      return;
    }

    // Cap the slider at remaining share capacity.
    if (slider) {
      slider.disabled = false;
      const cappedMax = Math.min(p.maxShares, remainingShares);
      slider.max = Math.max(1, cappedMax);
      if (Number(slider.value) > cappedMax) {
        slider.value = cappedMax;
        STATE.sliderValues[id] = cappedMax;
        updateChartAndAmount(id);
      }
    }
    if (buyBtn) { buyBtn.disabled = false; buyBtn.classList.remove('sold-out'); buyBtn.textContent = 'Buy this amount'; }
  }

  /** Open property detail modal and hydrate it with full data. */
  function openPropertyModal(id) {
    const p = PROPERTIES.find(x => x.id === id);
    if (!p) return;
    STATE.currentPropId = id;

    document.getElementById('sgPropModalTitle').textContent = p.name;
    document.getElementById('sgPmImg').src = p.image;
    document.getElementById('sgPmImg').alt = p.name;
    document.getElementById('sgPmType').textContent = p.type;
    document.getElementById('sgPmLoc').textContent = p.address || p.location;
    document.getElementById('sgPmTotalValue').textContent = p.totalValue;
    document.getElementById('sgPmPrice').textContent = '$' + p.price + ' / share';
    document.getElementById('sgPmYield').textContent = '+' + p.yield + '%';
    document.getElementById('sgPmOcc').textContent = p.occupancy;
    document.getElementById('sgPmDesc').textContent = p.desc;

    // Photo gallery — exterior + interiors
    const galleryImgs = (p.gallery && p.gallery.length ? p.gallery : [p.image]);
    renderGallery(galleryImgs, p.name);

    // Location map — Google Maps by address
    const mapQuery = encodeURIComponent(p.mapQuery || p.address || p.location);
    document.getElementById('sgPmMapFrame').src = `https://www.google.com/maps?q=${mapQuery}&output=embed`;
    document.getElementById('sgPmMapLink').href = `https://www.google.com/maps/search/?api=1&query=${mapQuery}`;

    // Specs grid
    const specsEl = document.getElementById('sgPmSpecs');
    specsEl.innerHTML = Object.entries(p.specs).map(([k,v]) =>
      `<div class="sg-prop__spec"><div class="sg-prop__spec-label">${k}</div><div class="sg-prop__spec-value">${v}</div></div>`
    ).join('');

    // Property walkthrough: local video if available, else photo tour
    const vw = document.getElementById('sgPmVideoWrap');
    if (STATE._tourInterval) { clearInterval(STATE._tourInterval); STATE._tourInterval = null; }
    const folder = String(p.videoUrl || p.image || '').replace(/\/[^/]+$/, '');
    const videoCandidates = Array.from(new Set([
      p.videoUrl,
      folder && (folder + '/main-video.mp4'),
      folder && (folder + '/tour.mp4'),
      folder && (folder + '/villa-tour.mp4'),
      folder && (folder + '/yacht-tour.mp4'),
      folder && (folder + '/video.mp4')
    ].filter(Boolean)));
    if (p.videoUrl || folder) {
      vw.innerHTML = `
        <div class="sg-prop__tour-player" style="position:relative;border-radius:12px;overflow:hidden;background:#0b0d17;aspect-ratio:16/9;">
          <video id="sgPmVideo" controls playsinline preload="metadata" style="width:100%;height:100%;object-fit:contain;display:block;background:#000;"
            poster="${p.image}"></video>
        </div>`;
      const vid = document.getElementById('sgPmVideo');
      let vi = 0;
      const tryNext = function () {
        if (vi >= videoCandidates.length) {
          vw.innerHTML = '<div style="padding:16px;color:#c9a96e;font-size:.85rem;text-align:center;">Video file is missing. Put main-video.mp4 next to the property photos.</div>';
          return;
        }
        vid.src = videoCandidates[vi++];
        vid.load();
      };
      vid.addEventListener('error', tryNext);
      tryNext();
    } else {
      const tourImgs = galleryImgs.slice(0, 6);
      let tourIdx = 0;
      vw.innerHTML = `
        <div class="sg-prop__tour-player" style="position:relative;border-radius:12px;overflow:hidden;background:#0b0d17;aspect-ratio:16/9;">
          <img id="sgTourImg" src="${tourImgs[0]}" alt="Tour" style="width:100%;height:100%;object-fit:cover;display:block;transition:opacity 0.5s;">
          <div style="position:absolute;bottom:0;left:0;right:0;padding:10px 14px;background:linear-gradient(transparent,rgba(0,0,0,0.75));display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.75rem;color:#fff;" id="sgTourLabel">Exterior &amp; interiors · 1 / ${tourImgs.length}</span>
            <span style="font-size:0.7rem;color:var(--sg-gold);">Auto tour</span>
          </div>
        </div>`;
      STATE._tourInterval = setInterval(() => {
        tourIdx = (tourIdx + 1) % tourImgs.length;
        const img = document.getElementById('sgTourImg');
        const lab = document.getElementById('sgTourLabel');
        if (img) { img.style.opacity = '0.4'; setTimeout(() => { img.src = tourImgs[tourIdx]; img.style.opacity = '1'; }, 200); }
        if (lab) lab.textContent = 'Exterior & interiors · ' + (tourIdx + 1) + ' / ' + tourImgs.length;
      }, 2800);
    }

    // The modal's "Add to Cart" button buys whatever amount is currently
    // selected on this property's catalog-card slider (falls back to the
    // slider minimum if the card hasn't rendered a value yet).
    const btn = document.getElementById('sgPmCartBtn');
    const remaining = remainingCapacity(p);
    if (remaining <= 0) {
      btn.textContent = 'Fully Reserved';
      btn.disabled = true;
      btn.style.opacity = '0.55';
    } else {
      btn.textContent = 'Add to Cart';
      btn.disabled = false;
      btn.style.opacity = '1';
    }

    openModal('sgPropModal');
  }

  /* --------------------------------------------------------------
     SECTION 8: CART / RESERVATION LOGIC
     Buying a property share reserves part of its total value from a
     shared pool (STATE.reserved) and accumulates the buyer's own stake
     in STATE.cart. The same property can be bought again in further
     parts (topping up) until the property's full value is reserved.
  -------------------------------------------------------------- */
  /** Total $ already invested in portfolio shares. */
  function portfolioInvestedTotal() {
    return STATE.portfolio.reduce((s, e) => s + e.amount, 0);
  }

  /** Property-only amounts currently in cart. */
  function cartPropertyTotal() {
    return STATE.cart.filter(c => c.type === 'property' || !c.type).reduce((s, c) => s + c.amount, 0);
  }

  /** Max investment allowed by current share plan (0 if none). */
  function planMaxInvest() {
    return STATE.sharePlan ? STATE.sharePlan.maxInvest : 0;
  }

  /** Remaining capacity under current share plan. */
  function planRemainingCapacity() {
    return Math.max(0, planMaxInvest() - portfolioInvestedTotal() - cartPropertyTotal());
  }

  /** Buy `amount` of property `id`, clamped to max 10 shares, property pool and plan limit. */
  function buyShare(id, amount) {
    if (!STATE.isLoggedIn) {
      showToast('Please sign in first.');
      showPage('sgPageAuth');
      return;
    }
    if (!STATE.sharePlan) {
      showToast('Please buy a Share Plan first.');
      const sec = document.getElementById('sgPlansSection');
      if (sec) sec.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    const p = PROPERTIES.find(x => x.id === id);
    if (!p) return;

    const remaining = remainingCapacity(p);
    if (remaining <= 0) {
      showToast(p.name + ' is fully reserved.');
      updateProgressUI(id);
      return;
    }

    const planLeft = planRemainingCapacity();
    if (planLeft <= 0) {
      showToast('Plan limit reached. Upgrade your Share Plan for more capacity.');
      return;
    }

    // Hard cap: max 10 shares per purchase
    const maxByShares = p.price * Math.min(MAX_SHARES_PER_PURCHASE, p.maxShares);
    const finalAmount = Math.max(0, Math.min(amount, remaining, maxByShares, planLeft));
    if (finalAmount <= 0) return;

    STATE.reserved[id] += finalAmount;

    const existing = STATE.cart.find(c => (c.type === 'property' || !c.type) && c.id === id);
    if (existing) existing.amount += finalAmount;
    else STATE.cart.push({ type: 'property', id: p.id, name: p.name, amount: finalAmount });

    renderCartUI();
    updateCartBadge();
    updateProgressUI(id);
    renderPlansUI();

    const nowFull = remainingCapacity(p) <= 0;
    showToast(`${fmtMoney(finalAmount)} of ${p.name} reserved` + (nowFull ? ' — property fully reserved!' : ''));
  }

  /** Add a license package to cart (replaces any other license in cart). */
  function addLicenseToCart(licId) {
    if (!STATE.isLoggedIn) {
      showToast('Please sign in first.');
      showPage('sgPageAuth');
      return;
    }
    const pack = LICENSE_PACKAGES.find(x => x.id === licId);
    if (!pack) return;
    if (STATE.license && Date.now() < STATE.license.expiresAt) {
      showToast('You already have an active license until ' + fmtMoscow(STATE.license.expiresAt));
      return;
    }
    // Only one license line in cart
    STATE.cart = STATE.cart.filter(c => c.type !== 'license');
    STATE.cart.push({
      type: 'license',
      id: pack.id,
      name: pack.name,
      amount: pack.price,
      months: pack.months
    });
    renderCartUI();
    updateCartBadge();
    renderPlansUI();
    showToast(pack.name + ' added to cart');
  }

  /** Add / upgrade share plan to cart. Upgrade = pay difference only. */
  function addPlanToCart(planId) {
    if (!STATE.isLoggedIn) {
      showToast('Please sign in first.');
      showPage('sgPageAuth');
      return;
    }
    const plan = SHARE_PLANS.find(x => x.id === planId);
    if (!plan) return;

    const current = STATE.sharePlan;
    if (current) {
      const curIdx = SHARE_PLANS.findIndex(x => x.id === current.id);
      const newIdx = SHARE_PLANS.findIndex(x => x.id === plan.id);
      if (newIdx <= curIdx) {
        showToast('Plans cannot be downgraded. You can only upgrade.');
        return;
      }
    }

    const paidAlready = current ? current.price : 0;
    const toPay = Math.max(0, plan.price - paidAlready);
    if (toPay <= 0) {
      showToast('This plan is already available.');
      return;
    }

    STATE.cart = STATE.cart.filter(c => c.type !== 'plan');
    STATE.cart.push({
      type: 'plan',
      id: plan.id,
      name: current ? ('Upgrade → ' + plan.name) : plan.name,
      amount: toPay,
      planPrice: plan.price,
      maxInvest: plan.maxInvest,
      minInvest: plan.minInvest
    });
    renderCartUI();
    updateCartBadge();
    renderPlansUI();
    showToast((current ? 'Upgrade: ' : '') + plan.name + ' — ' + fmtMoney(toPay) + ' in cart');
  }

  /** Remove a cart line by unique key (type+id). */
  function removeFromCart(cartKey) {
    // cartKey format: "property:apex-residences" | "license:lic-1m" | "plan:plan-starter"
    const [type, id] = String(cartKey).split(':');
    const item = STATE.cart.find(c => (c.type || 'property') === type && c.id === id);
    if (item && (item.type === 'property' || !item.type)) {
      STATE.reserved[id] = Math.max(0, (STATE.reserved[id] || 0) - item.amount);
      updateProgressUI(id);
    }
    STATE.cart = STATE.cart.filter(c => !((c.type || 'property') === type && c.id === id));
    renderCartUI();
    updateCartBadge();
    renderPlansUI();
  }

  /** Sum of all cart line amounts. */
  function cartTotal() { return STATE.cart.reduce((s, c) => s + c.amount, 0); }

  /** Update cart badge in header. */
  function updateCartBadge() {
    const badge = document.getElementById('sgCartBadge');
    badge.textContent = STATE.cart.length;
    badge.style.display = STATE.cart.length > 0 ? 'flex' : 'none';
  }

  /** Type badge label for cart rows. */
  function cartTypeLabel(c) {
    if (c.type === 'license') return 'License';
    if (c.type === 'plan') return 'Plan';
    return 'Shares';
  }

  /** Render cart list, empty state, total, and balance warning. */
  function renderCartUI() {
    const empty = document.getElementById('sgCartEmpty');
    const list = document.getElementById('sgCartList');
    const summary = document.getElementById('sgCartSummary');
    const hint = document.getElementById('sgDepHint');

    if (STATE.cart.length === 0) {
      empty.style.display = '';
      list.style.display = 'none';
      summary.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    list.style.display = 'block';
    summary.style.display = 'block';

    list.innerHTML = STATE.cart.map(c => {
      const type = c.type || 'property';
      const key = type + ':' + c.id;
      return `
      <div class="sg-cabinet__cart-item">
        <div>
          <div class="sg-cabinet__cart-name">${c.name}</div>
          <div style="font-size:0.72rem;color:var(--sg-cream-dark);margin-top:2px;">${cartTypeLabel(c)}</div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="sg-cabinet__cart-price">${fmtMoney(c.amount)}</span>
          <button class="sg-cabinet__cart-remove" type="button" data-remove-id="${key}" aria-label="Remove">×</button>
        </div>
      </div>`;
    }).join('');

    const total = cartTotal();
    document.getElementById('sgCartTotal').textContent = fmtMoney(total);

    if (STATE.confirmedBalance < total) {
      const need = total - STATE.confirmedBalance;
      hint.style.display = 'block';
      hint.textContent = `⚠ Your confirmed balance ($${STATE.confirmedBalance.toFixed(2)}) is $${need.toFixed(2)} short. Deposit to proceed.`;
    } else {
      hint.style.display = 'none';
    }
    document.getElementById('sgCheckoutBtn').disabled = STATE.confirmedBalance < total;
  }

  /* --------------------------------------------------------------
     SECTION 9: DEPOSIT REQUEST SYSTEM
     Does NOT auto-update balance. Leaves an empty "I have paid"
     button for admin/backend integration.
  -------------------------------------------------------------- */
  /** Deposit is USDT (TRC20) only. */
  STATE.payMethod = 'usdt';

  function setPayMethod(method) {
    STATE.payMethod = 'usdt';
  }

  /** Open deposit modal with smart amount suggestion. */
  function openDepositModal() {
    const total = cartTotal();
    const amtInput = document.getElementById('sgDepositAmount');
    amtInput.value = total >= CONFIG.MIN_DEPOSIT ? total : String(CONFIG.MIN_DEPOSIT);

    const hintBox = document.getElementById('sgDepositHintBox');
    hintBox.innerHTML = total >= CONFIG.MIN_DEPOSIT
      ? `Minimum deposit: <strong>$${CONFIG.MIN_DEPOSIT}</strong>. Cart total: <strong>${fmtMoney(total)}</strong> — suggested amount.`
      : `Minimum deposit: <strong>$${CONFIG.MIN_DEPOSIT}</strong>`;

    // Reset UI states
    document.getElementById('sgDepositPendingMsg').classList.remove('show');
    document.getElementById('sgDepositConfirmBtn').disabled = false;
    document.getElementById('sgIHavePaidBtn').style.display = 'none';
    const latestPending = (STATE.pendingDeposits || []).find(d => d.status === 'pending');
    if (latestPending) {
      document.getElementById('sgDepositPendingAmt').textContent = '$' + Number(latestPending.amount).toFixed(2);
      document.getElementById('sgDepositPendingMethod').textContent = latestPending.method || CONFIG.CURRENCY;
      document.getElementById('sgDepositPendingMsg').classList.add('show');
      const paidBtn = document.getElementById('sgIHavePaidBtn');
      paidBtn.style.display = 'flex';
      paidBtn.disabled = !!latestPending.userConfirmedPaid;
      paidBtn.innerHTML = '<span class="t-btnflex__text">' + (latestPending.userConfirmedPaid ? 'Payment reported ✓' : 'I have paid') + '</span>';
      paidBtn.dataset.confirmDeposit = String(STATE.pendingDeposits.indexOf(latestPending));
    }
    setPayMethod('usdt');

    openModal('sgDepositModal');
  }

  /** Very light client-side sanity checks for the card panel (NOT real validation/PCI handling). */
  /**
   * Build a deposit request payload for the future backend.
   * POST {API_BASE}/api/v1/deposits
   * Authorization: Bearer <token>
   */
  function buildDepositRequest(amount) {
    return {
      type: 'deposit',
      amount: Number(amount),
      currency: CONFIG.CURRENCY,
      network: CONFIG.NETWORK,
      toAddress: CONFIG.DEPOSIT_WALLET,
      user: STATE.user ? { email: STATE.user.email, name: STATE.user.name } : null,
      clientRequestId: 'dep_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10),
      createdAt: new Date().toISOString(),
      status: 'pending_confirmation'
    };
  }

  /**
   * Submit deposit request.
   * If CONFIG.API_BASE is set, POSTs to backend; otherwise queues locally.
   */
  async function handleDeposit() {
    const raw = parseFloat(document.getElementById('sgDepositAmount').value);
    if (!raw || raw < CONFIG.MIN_DEPOSIT) {
      showToast(`Minimum deposit is $${CONFIG.MIN_DEPOSIT}`);
      return;
    }

    const payload = buildDepositRequest(raw);
    const methodLabel = `${CONFIG.CURRENCY} (${CONFIG.NETWORK})`;
    const now = new Date().toLocaleString('en-GB', {
      day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit'
    });

    document.getElementById('sgDepositConfirmBtn').disabled = true;

    try {
      if (CONFIG.USE_BACKEND) {
        const data = await apiFetch('/api/v1/deposits', {
          method: 'POST',
          body: JSON.stringify({
            amount: raw,
            clientRequestId: payload.clientRequestId,
            currency: CONFIG.CURRENCY,
            network: CONFIG.NETWORK
          })
        });
        payload.serverId = data.id || data.requestId || null;
        payload.status = data.status || 'pending';
      }

      STATE.pendingDeposits.push({
        amount: raw,
        date: now,
        status: 'pending',
        method: methodLabel,
        clientRequestId: payload.clientRequestId,
        serverId: payload.serverId || null,
        payload: payload
      });

      renderPendingList();
      addHistory(`Deposit request — $${raw} (${methodLabel})`, raw, 'pending');

      document.getElementById('sgDepositPendingAmt').textContent = '$' + raw;
      document.getElementById('sgDepositPendingMethod').textContent = methodLabel;
      document.getElementById('sgDepositPendingMsg').classList.add('show');
      const paidBtn = document.getElementById('sgIHavePaidBtn');
      paidBtn.style.display = 'flex';
      paidBtn.disabled = false;
      paidBtn.dataset.depositId = String(payload.serverId || '');
      paidBtn.dataset.confirmDeposit = String(STATE.pendingDeposits.length - 1);
      paidBtn.innerHTML = '<span class="t-btnflex__text">I have paid</span>';
      showToast('Deposit request submitted! Pending verification.');
    } catch (err) {
      document.getElementById('sgDepositConfirmBtn').disabled = false;
      showToast(err.message || 'Deposit request failed');
    }
  }

  /** Render the pending deposits panel inside the cabinet. */
  function renderPendingList() {
    const wrap=document.getElementById('sgPendingList'), itemsEl=document.getElementById('sgPendingItems');
    if (!wrap || !itemsEl) return;
    if (!STATE.pendingDeposits.length) { wrap.classList.remove('show'); return; }
    wrap.classList.add('show');
    const visible=STATE.pendingDeposits.map((d,idx)=>({d,idx})).filter(x=>x.d.status==='pending' && !x.d.userConfirmedPaid);
    if (!visible.length) { wrap.classList.remove('show'); itemsEl.innerHTML=''; return; }
    itemsEl.innerHTML=visible.map(({d,idx})=>{
      return '<div class="sg-cabinet__pending-item"><span style="flex:1;min-width:140px;">Request #'+(idx+1)+' — '+d.date+'</span><span style="color:#f0c244;white-space:nowrap;">+$'+Number(d.amount).toFixed(2)+' ('+(d.method||CONFIG.CURRENCY)+') — pending</span><button class="t-btnflex t-btnflex_sm t-btnflex--outline" style="border-color:rgba(240,194,68,.3);color:#f0c244;font-size:.75rem;padding:6px 14px;" type="button" data-confirm-deposit="'+idx+'" data-deposit-id="'+(d.serverId||'')+'"><span class="t-btnflex__text">I have paid</span></button></div>';
    }).join('');
  }

  /* --------------------------------------------------------------
     SECTION 10: WITHDRAWAL SYSTEM
  -------------------------------------------------------------- */
  const WITHDRAW_FEE = CONFIG.WITHDRAW_FEE || 8.5;

  function openWithdrawModal() {
    document.getElementById('sgWithdrawAmount').value = '';
    document.getElementById('sgWithdrawAddr').value = '';
    const maxSend = Math.max(0, STATE.confirmedBalance - WITHDRAW_FEE);
    document.getElementById('sgWithdrawBalHint').textContent =
      'Available balance: $' + STATE.confirmedBalance.toFixed(2) +
      ' · Max send: $' + maxSend.toFixed(2) + ' (after $' + WITHDRAW_FEE.toFixed(2) + ' fee)';
    openModal('sgWithdrawModal');
  }

  /**
   * Build a withdrawal request payload for the future backend.
   * POST {API_BASE}/api/v1/withdrawals
   * Authorization: Bearer <token>
   */
  function buildWithdrawRequest(amount, toAddress) {
    return {
      type: 'withdrawal',
      amount: Number(amount),
      fee: WITHDRAW_FEE,
      totalDebit: Number(amount) + WITHDRAW_FEE,
      currency: CONFIG.CURRENCY,
      network: CONFIG.NETWORK,
      toAddress: toAddress,
      user: STATE.user ? { email: STATE.user.email, name: STATE.user.name } : null,
      clientRequestId: 'wd_' + Date.now() + '_' + Math.random().toString(36).slice(2, 10),
      createdAt: new Date().toISOString(),
      status: 'pending_review'
    };
  }

  /**
   * Submit withdrawal request.
   * If CONFIG.API_BASE is set, POSTs to backend; otherwise processes locally
   * (debits balance and logs history) for demo mode.
   */
  async function handleWithdraw() {
    const amt = parseFloat(document.getElementById('sgWithdrawAmount').value);
    const addr = document.getElementById('sgWithdrawAddr').value.trim();

    if (!amt || amt <= 0) { showToast('Enter a withdrawal amount'); return; }
    const totalDebit = amt + WITHDRAW_FEE;
    if (totalDebit > STATE.confirmedBalance) {
      showToast('Insufficient balance. Need $' + totalDebit.toFixed(2) + ' (amount + $' + WITHDRAW_FEE.toFixed(2) + ' fee)');
      return;
    }
    // Basic TRC20 address check: starts with T, length ~34
    if (!addr || addr.length < 26) {
      showToast('Please enter a valid TRC20 address');
      return;
    }

    const payload = buildWithdrawRequest(amt, addr);
    const btn = document.getElementById('sgWithdrawConfirmBtn');
    if (btn) btn.disabled = true;

    try {
      if (CONFIG.USE_BACKEND) {
        const data = await apiFetch('/api/v1/withdrawals', {
          method: 'POST',
          body: JSON.stringify({
            amount: amt,
            toAddress: addr,
            clientRequestId: payload.clientRequestId
          })
        });
        payload.serverId = data.id || data.requestId || null;
        payload.status = data.status || 'pending';
        if (typeof data.balance === 'number') STATE.confirmedBalance = data.balance;
        else STATE.confirmedBalance -= totalDebit;
      } else {
        STATE.confirmedBalance -= totalDebit;
      }

      if (!STATE.pendingWithdrawals) STATE.pendingWithdrawals = [];
      STATE.pendingWithdrawals.push(payload);

      updateBalanceUI();
      addHistory(
        'Withdrawal — $' + amt.toFixed(2) + ' + fee $' + WITHDRAW_FEE.toFixed(2) + ' to …' + addr.slice(-6),
        totalDebit,
        'negative'
      );
      closeAllModals();
      showToast('Withdrawal $' + amt.toFixed(2) + ' submitted (fee $' + WITHDRAW_FEE.toFixed(2) + ')');
    } catch (err) {
      showToast(err.message || 'Withdrawal request failed');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* --------------------------------------------------------------
     SECTION 11: BALANCE & HISTORY
  -------------------------------------------------------------- */
  /** Refresh balance display + cart availability warning. */
  function normalizeLicense(lic) {
    if (!lic) return null;
    const exp = lic.expiresAtMs || lic.expiresAt;
    const expiresAt = typeof exp === 'number' ? exp : (exp ? new Date(exp).getTime() : 0);
    if (!expiresAt || Number.isNaN(expiresAt)) return null;
    return {
      id: lic.id,
      price: Number(lic.price || 0),
      months: lic.months || 1,
      purchasedAt: lic.purchasedAt ? (typeof lic.purchasedAt === 'number' ? lic.purchasedAt : new Date(lic.purchasedAt).getTime()) : Date.now(),
      expiresAt
    };
  }

  function normalizePlan(plan) {
    if (!plan) return null;
    const meta = SHARE_PLANS.find(x => x.id === plan.id) || {};
    return {
      id: plan.id,
      name: plan.name || meta.name || plan.id,
      minInvest: Number(plan.minInvest != null ? plan.minInvest : meta.minInvest || 0),
      maxInvest: Number(plan.maxInvest != null ? plan.maxInvest : meta.maxInvest || 0),
      price: Number(plan.price != null ? plan.price : meta.price || 0),
      purchasedAt: plan.purchasedAt || Date.now()
    };
  }

  function updateBalanceUI() {
    document.getElementById('sgCabinetBalance').textContent =
      '$' + STATE.confirmedBalance.toFixed(2);
    document.getElementById('sgBalanceHint').textContent =
      STATE.confirmedBalance > 0 ? 'Verified & available for investing' : 'Submit a deposit to start investing';
    renderCartUI();
  }

  /** Add entry to transaction history. */
  function addHistory(title, amount, type) {
    const now = new Date();
    const date = now.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    STATE.history.unshift({ title, amount, type, date });
    renderHistory();
  }

  /** Render transaction history list. */
  function renderHistory() {
    const el = document.getElementById('sgHistoryList');
    if (STATE.history.length === 0) {
      el.innerHTML = '<div style="padding:24px;text-align:center;color:var(--sg-cream-dark);"><p>No transactions yet.</p></div>';
      return;
    }
    el.innerHTML = STATE.history.map(h => `
      <div class="sg-cabinet__history-item"> <div> <div class="sg-cabinet__history-title">${h.title}</div> <div class="sg-cabinet__history-date">${h.date}</div> </div> <div class="sg-cabinet__history-amount ${h.type}">
          ${h.type === 'negative' ? '-' : '+'}$${Math.abs(h.amount).toFixed(2)}
        </div> </div>`).join('');
  }

  /* --------------------------------------------------------------
     SECTION 11b: PORTFOLIO / DAILY INCOME (Moscow time)
     Owned shares in STATE.portfolio. Daily income =
     amount * (yield%/100) / 365.
     First claim unlocks after 7 days from purchase, then every 24 h.
     All timers use Europe/Moscow (UTC+3).
  -------------------------------------------------------------- */
  const MS_24H = 24 * 60 * 60 * 1000;
  const MS_7D  = 7 * MS_24H;
  let _portfolioTimerId = null;

  /** Full Moscow datetime: «21.08.2026, 19:45:32 MSK» */
  function fmtMoscow(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false
    }) + ' MSK';
  }

  /** Remaining time as «Xд Yч Zм Ws» */
  function fmtCountdown(ms) {
    if (ms <= 0) return '0с';
    const s = Math.floor(ms / 1000);
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const parts = [];
    if (d > 0) parts.push(d + 'д');
    if (h > 0 || d > 0) parts.push(h + 'ч');
    if (m > 0 || h > 0 || d > 0) parts.push(m + 'м');
    parts.push(sec + 'с');
    return parts.join(' ');
  }

  const FIRST_SHARE_BONUS_PCT = 50;

  const FIRST_SHARE_BONUS_USD = 60;

  function firstBonusOf(entry) {
    return FIRST_SHARE_BONUS_USD;
  }

  /**
   * Portfolio income rules:
   * - FIRST share purchase ever: 7-day wait, then one-time +50% of invested amount.
   * - Subsequent purchases: daily income from 2.5%/day, progressing +0.25% per later purchase.
   */
  function portfolioPurchaseIndex(entry) {
    // Sort by purchase time; first = 0
    const ordered = STATE.portfolio.slice().sort((a, b) => a.purchasedAt - b.purchasedAt);
    return ordered.findIndex(x => x.id === entry.id && x.purchasedAt === entry.purchasedAt);
  }

  function isBonusShare(entry) {
    return portfolioPurchaseIndex(entry) === 0 && Number(entry && entry.amount) <= 170;
  }

  function isFirstSharePurchase(entry) {
    return isBonusShare(entry) && !entry.bonusClaimed;
  }

  function isDailyShare(entry) {
    if (!entry) return false;
    if (!isBonusShare(entry)) return true;
    return !!entry.bonusClaimed;
  }

  function dailyRateOf(entry) {
    const idx = portfolioPurchaseIndex(entry);
    const dailyIdx = isBonusShare(entry) ? 0 : (Number(entry.amount) > 170 ? Math.max(0, idx) : Math.max(0, idx - 1));
    return 0.025 + dailyIdx * 0.0025;
  }

  function dailyIncomeOf(entry) {
    if (isFirstSharePurchase(entry)) return 0;
    return entry.amount * dailyRateOf(entry);
  }

  function missedDaysOf(entry) {
    if (isFirstSharePurchase(entry)) return canClaim(entry) ? 1 : 0;
    const now = Date.now();
    const unlock = unlockAt(entry);
    if (now < unlock) return 0;
    const start = entry.lastClaimAt || unlock;
    if (!entry.lastClaimAt) return Math.max(1, Math.floor((now - start) / MS_24H) || 1);
    return Math.max(0, Math.floor((now - start) / MS_24H));
  }

  function claimAmountOf(entry) {
    if (isFirstSharePurchase(entry)) {
      if (entry.bonusClaimed) return 0;
      return firstBonusOf(entry);
    }
    const days = missedDaysOf(entry);
    return dailyIncomeOf(entry) * Math.max(0, days);
  }

  function unlockAt(entry) {
    return Number(entry.purchasedAt) + MS_7D;
  }

  function canClaim(entry) {
    const now = Date.now();
    if (now < unlockAt(entry)) return false;
    if (isBonusShare(entry) && !entry.bonusClaimed) return true;
    if (entry.lastClaimAt == null) return true;
    return (now - entry.lastClaimAt) >= MS_24H;
  }

  function nextClaimAt(entry) {
    if (canClaim(entry)) return null;
    if (isFirstSharePurchase(entry)) {
      if (entry.bonusClaimed) return null;
      return unlockAt(entry);
    }
    const unlock = unlockAt(entry);
    const now = Date.now();
    if (now < unlock) return unlock;
    if (entry.lastClaimAt == null) return unlock;
    return entry.lastClaimAt + MS_24H;
  }

  function claimProgress(entry) {
    const now = Date.now();
    const unlock = unlockAt(entry);
    if (isBonusShare(entry) && !entry.bonusClaimed) {
      if (now < unlock) {
        const elapsed = now - entry.purchasedAt;
        return {
          phase: 'unlock',
          pct: Math.min(100, Math.max(0, (elapsed / MS_7D) * 100)),
          remaining: unlock - now,
          label: '7-day activation · +' + FIRST_SHARE_BONUS_PCT + '% then daily',
          target: unlock
        };
      }
      return { phase: 'ready', pct: 100, remaining: 0, label: 'Ready to claim +' + FIRST_SHARE_BONUS_PCT + '% ($' + firstBonusOf(entry).toFixed(2) + ')', target: unlock };
    }
    // daily (including $170 share after bonus)
    if (now < unlock) {
      const elapsed = now - entry.purchasedAt;
      return {
        phase: 'unlock',
        pct: Math.min(100, Math.max(0, (elapsed / MS_7D) * 100)),
        remaining: unlock - now,
        label: 'Activation · then ' + (dailyRateOf(entry) * 100).toFixed(2) + '% / day',
        target: unlock
      };
    }
    if (entry.lastClaimAt == null || (now - entry.lastClaimAt) >= MS_24H) {
      return { phase: 'ready', pct: 100, remaining: 0, label: 'Daily income ready', target: now };
    }
    const next = entry.lastClaimAt + MS_24H;
    const elapsed = now - entry.lastClaimAt;
    return {
      phase: 'cooldown',
      pct: Math.min(100, (elapsed / MS_24H) * 100),
      remaining: next - now,
      label: 'Next claim in',
      target: next
    };
  }

  async function claimShareIncome(id) {
    const nid=Number(id); const entry=STATE.portfolio.find(x=>Number(x.id)===nid); if(!entry)return;
    if(!canClaim(entry)){showToast('Income not available yet. Wait for the timer (Moscow time).');return;}
    try{
      if(CONFIG.USE_BACKEND){const data=await apiFetch('/api/v1/portfolio/'+encodeURIComponent(id)+'/claim',{method:'POST',body:'{}'});STATE.confirmedBalance=Number(data.balance);STATE.portfolio=(data.portfolio||[]).map(p=>({id:Number(p.id),propertyId:p.property_id||p.propertyId,name:p.name,amount:Number(p.amount),yield:Math.min(50,Number(p.yield)||0),purchasedAt:new Date(p.purchased_at||p.purchasedAt).getTime(),lastClaimAt:(p.last_claim_at||p.lastClaimAt)?new Date(p.last_claim_at||p.lastClaimAt).getTime():null,bonusClaimed:!!p.bonus_claimed||!!p.bonusClaimed}));addHistory((isFirstSharePurchase(entry)?'Activation bonus — ':'Daily income — ')+entry.name,Number(data.income),'positive');updateBalanceUI();renderPortfolioUI();showToast('+$'+Number(data.income).toFixed(2)+' credited to your balance');return;}
      const income=claimAmountOf(entry);if(income<=0)return;STATE.confirmedBalance+=income;entry.lastClaimAt=Date.now();if(isFirstSharePurchase(entry))entry.bonusClaimed=true;addHistory((isFirstSharePurchase(entry)?'Activation bonus — ':'Daily income — ')+entry.name,income,'positive');updateBalanceUI();renderPortfolioUI();showToast('+$'+income.toFixed(2)+' credited to your balance');
    }catch(err){showToast(err.message||'Income claim failed');}
  }


  /** Live-update only the timer/progress parts without full re-render flicker. */
  function tickPortfolioTimers() {
    if (!STATE.portfolio.length) return;
    const panel = document.getElementById('tabPortfolio');
    if (!panel || !panel.classList.contains('active')) return;

    let needsFullRender = false;
    STATE.portfolio.forEach(entry => {
      const item = document.querySelector(`[data-portfolio-id="${entry.id}"]`);
      if (!item) return;
      const prog = claimProgress(entry);
      const ready = prog.phase === 'ready';

      const fill = item.querySelector('.sg-cabinet__wait-fill');
      const countdown = item.querySelector('.sg-cabinet__wait-countdown');
      const phaseLabel = item.querySelector('.sg-cabinet__wait-phase');
      const targetDate = item.querySelector('.sg-cabinet__wait-target');
      const word = item.querySelector('.sg-cabinet__wait-word');
      const btn = item.querySelector('[data-claim-id]');

      if (fill) {
        fill.style.width = prog.pct.toFixed(2) + '%';
        fill.classList.toggle('is-ready', ready);
        fill.classList.toggle('is-unlock', prog.phase === 'unlock');
        fill.classList.toggle('is-cooldown', prog.phase === 'cooldown');
      }
      if (countdown) countdown.textContent = ready ? 'Ready!' : fmtCountdown(prog.remaining);
      if (phaseLabel) phaseLabel.textContent = ready ? 'Ready' : (prog.phase === 'done' ? prog.label : 'waiting');
      if (word) word.textContent = ready ? 'Ready' : (prog.phase === 'done' ? 'Done' : 'waiting');
      if (targetDate) {
        targetDate.textContent = ready
          ? 'Можно забрать доход'
          : ('Доступно: ' + fmtMoscow(prog.target));
      }
      if (btn) {
        const wasDisabled = btn.disabled;
        btn.disabled = !ready;
        btn.textContent = ready ? 'Claim income' : 'waiting';
        btn.classList.toggle('is-ready', ready);
        if (wasDisabled && ready) needsFullRender = true;
      } else if (ready) {
        needsFullRender = true;
      }
    });

    if (needsFullRender) renderPortfolioUI();
  }

  function startPortfolioTimer() {
    if (_portfolioTimerId) clearInterval(_portfolioTimerId);
    _portfolioTimerId = setInterval(function () {
      if (checkLicenseExpiry()) renderPlansUI();
      tickPortfolioTimers();
      updateLicenseStatusUI();
    }, 1000);
  }

  /** Status strip for active license / plan (in plans section + cabinet). */
  function updateLicenseStatusUI() {
    const licEl = document.getElementById('sgLicenseStatus');
    const planEl = document.getElementById('sgPlanStatus');
    if (licEl) {
      if (STATE.license && Date.now() < STATE.license.expiresAt) {
        const left = STATE.license.expiresAt - Date.now();
        licEl.innerHTML = `<span class="sg-plans__status-ok">Active until ${fmtMoscow(STATE.license.expiresAt)}</span>
          <span class="sg-plans__status-cd">${fmtCountdown(left)}</span>`;
      } else {
        licEl.innerHTML = '<span class="sg-plans__status-off">No active license</span>';
      }
    }
    if (planEl) {
      if (STATE.sharePlan) {
        const used = portfolioInvestedTotal() + cartPropertyTotal();
        planEl.innerHTML = `<span class="sg-plans__status-ok">${STATE.sharePlan.name}</span>
          <span class="sg-plans__status-cd">${fmtMoney(used)} / ${fmtMoney(STATE.sharePlan.maxInvest)}</span>`;
      } else {
        planEl.innerHTML = '<span class="sg-plans__status-off">No plan selected — buy a Share Plan to purchase shares</span>';
      }
    }
  }

  /** Render License packages + Share Plans cards. */
  function renderPlansUI() {
    const licGrid = document.getElementById('sgLicenseGrid');
    const planGrid = document.getElementById('sgSharePlanGrid');
    if (!licGrid || !planGrid) return;

    const activeLic = STATE.license && Date.now() < STATE.license.expiresAt;
    const licInCart = STATE.cart.find(c => c.type === 'license');

    licGrid.innerHTML = LICENSE_PACKAGES.map(pack => {
      const inCart = licInCart && licInCart.id === pack.id;
      const disabled = activeLic;
      const monthLabel = pack.months === 1 ? '1 Month' : pack.months + ' Months';
      return `
        <div class="sg-plans__card sg-plans__card--license${inCart ? ' is-incart' : ''}${disabled ? ' is-disabled' : ''}">
          <div class="sg-plans__tag">${pack.tag}</div>
          <h3 class="sg-plans__name">${monthLabel}</h3>
          <div class="sg-plans__price">$${pack.price}</div>
          <p class="sg-plans__desc">${pack.desc}</p>
          <ul class="sg-plans__perks">
            <li>Career access for the full term</li>
            <li>$${pack.price} returned to balance on expiry</li>
            <li>Renew for any term after it ends</li>
          </ul>
          <button type="button" class="sg-plans__btn" data-add-license="${pack.id}" ${disabled ? 'disabled' : ''}>
            ${disabled ? 'License active' : inCart ? 'In cart' : 'Add to cart'}
          </button>
        </div>`;
    }).join('');

    const curIdx = STATE.sharePlan
      ? SHARE_PLANS.findIndex(x => x.id === STATE.sharePlan.id)
      : -1;
    const planInCart = STATE.cart.find(c => c.type === 'plan');

    planGrid.innerHTML = SHARE_PLANS.map((plan, idx) => {
      const isCurrent = STATE.sharePlan && STATE.sharePlan.id === plan.id;
      const isLower = curIdx >= 0 && idx < curIdx;
      const isUpgrade = curIdx >= 0 && idx > curIdx;
      const inCart = planInCart && planInCart.id === plan.id;
      const toPay = isUpgrade
        ? plan.price - STATE.sharePlan.price
        : plan.price;
      let btnLabel = 'Add to cart · $' + plan.price;
      let disabled = false;
      if (isCurrent) { btnLabel = 'Current plan'; disabled = true; }
      else if (isLower) { btnLabel = 'Unavailable (lower)'; disabled = true; }
      else if (isUpgrade) { btnLabel = 'Upgrade · +$' + toPay; }
      if (inCart) btnLabel = 'In cart';

      return `
        <div class="sg-plans__card sg-plans__card--plan${isCurrent ? ' is-current' : ''}${inCart ? ' is-incart' : ''}${isLower ? ' is-disabled' : ''}">
          <div class="sg-plans__tag">${plan.tag}</div>
          <h3 class="sg-plans__name">${plan.name}</h3>
          <div class="sg-plans__price">$${plan.price}</div>
          <div class="sg-plans__range">${fmtMoney(plan.minInvest)} — ${fmtMoney(plan.maxInvest)}</div>
          <p class="sg-plans__desc">${plan.desc}</p>
          <ul class="sg-plans__perks">
            <li>Investment limit up to ${fmtMoney(plan.maxInvest)}</li>
            <li>Plan stays forever</li>
            <li>${isUpgrade ? 'Pay only the difference' : 'Upgrade later anytime'}</li>
          </ul>
          <button type="button" class="sg-plans__btn" data-add-plan="${plan.id}" ${disabled ? 'disabled' : ''}>
            ${btnLabel}
          </button>
        </div>`;
    }).join('');

    updateLicenseStatusUI();
  }

  /** Render the My Shares (portfolio) tab with wait progress animation. */
  function renderPortfolioUI() {
    const empty = document.getElementById('sgPortfolioEmpty');
    const list  = document.getElementById('sgPortfolioList');
    const summary = document.getElementById('sgPortfolioSummary');
    if (!empty || !list || !summary) return;

    if (STATE.portfolio.length === 0) {
      empty.style.display = 'block';
      list.style.display = 'none';
      summary.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    list.style.display = 'block';
    summary.style.display = 'block';

    let totalInvested = 0;
    let totalDaily = 0;

    list.innerHTML = STATE.portfolio.map(entry => {
      const first = isBonusShare(entry) && !entry.bonusClaimed;
      const daily = dailyIncomeOf(entry);
      const ratePct = (dailyRateOf(entry) * 100).toFixed(2);
      totalInvested += entry.amount;
      totalDaily += daily;
      const prog = claimProgress(entry);
      const ready = prog.phase === 'ready';
      const phaseClass = ready ? 'is-ready' : (prog.phase === 'unlock' ? 'is-unlock' : (prog.phase === 'done' ? 'is-done' : 'is-cooldown'));
      const bonusAmt = firstBonusOf(entry);
      const incomeLine = first
        ? '<span>After 7 days (+' + FIRST_SHARE_BONUS_PCT + '%): <span class="sg-cabinet__portfolio-income">+$' + bonusAmt.toFixed(2) + '</span> · then daily ' + ratePct + '%</span>'
        : (isBonusShare(entry)
            ? '<span>Bonus +$' + bonusAmt.toFixed(2) + ' claimed · Daily (' + ratePct + '%): <span class="sg-cabinet__portfolio-income">+$' + daily.toFixed(4) + '</span></span>'
            : '<span>Daily income (' + ratePct + '%): <span class="sg-cabinet__portfolio-income">+$' + daily.toFixed(4) + '</span></span>');
      const accrued = claimAmountOf(entry);
      const btnLabel = ready
        ? (first ? 'Claim +$' + bonusAmt.toFixed(2) : 'Add to balance +$' + accrued.toFixed(2))
        : (prog.phase === 'done' ? 'Completed' : 'waiting');

      return `
        <div class="sg-cabinet__portfolio-item" data-portfolio-id="${entry.id}">
          <div class="sg-cabinet__portfolio-item-header">
            <div>
              <div class="sg-cabinet__portfolio-name">${entry.name}</div>
              <div class="sg-cabinet__portfolio-meta">${first ? 'First share · +' + FIRST_SHARE_BONUS_PCT + '% after 7 days' : ratePct + '% / day' + ('')} · Bought ${fmtMoscow(entry.purchasedAt)}</div>
              <div class="sg-cabinet__portfolio-rate">${Math.min(50, Number(entry.yield || 0)).toFixed(0)}% annual yield · up to 50%</div>
            </div>
            <div class="sg-cabinet__portfolio-amount">${fmtMoney(entry.amount)}</div>
          </div>
          <div class="sg-cabinet__portfolio-row">
            ${incomeLine}
          </div>
          <div class="sg-cabinet__wait ${phaseClass}">
            <div class="sg-cabinet__wait-meta">
              <span class="sg-cabinet__wait-phase">${ready ? 'Ready' : (prog.phase === 'done' ? 'Done' : 'Waiting')}</span>
              <span class="sg-cabinet__wait-countdown">${ready ? 'Ready' : (prog.phase === 'done' ? '—' : fmtCountdown(prog.remaining))}</span>
            </div>
            <div class="sg-cabinet__wait-bar"><div class="sg-cabinet__wait-fill ${phaseClass}" style="width:${prog.pct.toFixed(2)}%"></div></div>
            <div class="sg-cabinet__wait-target">${ready ? (first ? 'Claim +' + FIRST_SHARE_BONUS_PCT + '% ($' + bonusAmt.toFixed(2) + ')' : 'Claim daily income') : (prog.phase === 'done' ? 'Bonus claimed' : ('Available: ' + fmtMoscow(prog.target)))}</div>
          </div>
          ${ready ? '<button type="button" class="sg-cabinet__claim-btn is-ready" data-claim-id="'+entry.id+'">'+btnLabel+'</button>' : ''}
        </div>`;
    }).join('');

    document.getElementById('sgPortfolioInvested').textContent = fmtMoney(totalInvested);
    document.getElementById('sgPortfolioDaily').textContent = '+$' + totalDaily.toFixed(4);
    startPortfolioTimer();
  }

  /* --------------------------------------------------------------
     SECTION 12: AVATAR PICKER
  -------------------------------------------------------------- */
  function renderAvatarPicker() {
    const grid = document.getElementById('sgAvatarGrid');
    grid.innerHTML = CONFIG.AVATARS.map(emoji =>
      `<div class="sg-cabinet__avatar-opt${emoji === STATE.selectedAvatar ? ' selected' : ''}" data-avatar="${emoji}">${emoji}</div>`
    ).join('');
  }

  /* --------------------------------------------------------------
     SECTION 13: CHECKOUT
  -------------------------------------------------------------- */
  /** Build checkout review page from current cart. */
  function buildCheckoutPage() {
    document.getElementById('sgCheckoutList').innerHTML = STATE.cart.map(c =>
      `<div class="sg-checkout__item"><span>${c.name}</span><span>${fmtMoney(c.amount)}</span></div>`
    ).join('');
    document.getElementById('sgCheckoutTotal').textContent = fmtMoney(cartTotal());

    if (STATE.user) {
      const nameEl = document.getElementById('chkName');
      const emailEl = document.getElementById('chkEmail');
      if (nameEl) nameEl.value = STATE.user.name;
      if (emailEl) emailEl.value = STATE.user.email;
    }
  }

  /** Complete checkout: process property / license / plan items. */
  async function completePurchase() {
    const total=cartTotal();
    if(!STATE.cart.length){showToast('Cart is empty');return;}
    if(STATE.confirmedBalance<total){showToast('Insufficient balance');return;}
    const properties=STATE.cart.filter(c=>(c.type||'property')==='property');
    let boughtShares=false;
    try{
      if(CONFIG.USE_BACKEND && properties.length){
        const data=await apiFetch('/api/v1/portfolio/purchase',{method:'POST',body:JSON.stringify({clientRequestId:'purchase_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),items:properties.map(c=>({id:c.id,name:c.name,amount:Number(c.amount)}))})});
        STATE.confirmedBalance=Number(data.balance); STATE.portfolio=(data.portfolio||[]).filter(p=>p.user_id===undefined||p.user_id===STATE.user.id).map(p=>({id:Number(p.id),propertyId:p.property_id||p.propertyId,name:p.name,amount:Number(p.amount),yield:Math.min(50,Number(p.yield)||0),purchasedAt:new Date(p.purchased_at||p.purchasedAt).getTime(),lastClaimAt:(p.last_claim_at||p.lastClaimAt)?new Date(p.last_claim_at||p.lastClaimAt).getTime():null,bonusClaimed:!!p.bonus_claimed||!!p.bonusClaimed}));
        boughtShares=true;
      }else if(!CONFIG.USE_BACKEND){
        STATE.confirmedBalance-=total; const now=Date.now();
        properties.forEach(c=>{const p=PROPERTIES.find(x=>x.id===c.id);const y=Math.min(50,p?p.yield:12);STATE.portfolio.push({id:c.id,propertyId:c.id,name:c.name,amount:c.amount,yield:y,purchasedAt:now,lastClaimAt:null,bonusClaimed:false});addHistory('Investment — '+c.name,c.amount,'negative');}); boughtShares=properties.length>0;
      }
      const nonProps=STATE.cart.filter(c=>(c.type||'property')!=='property');
      if(nonProps.length){
        const nonTotal=nonProps.reduce((a,c)=>a+Number(c.amount||0),0);
        const now=Date.now();
        if(CONFIG.USE_BACKEND){
          const data=await apiFetch('/api/v1/account/extras',{method:'POST',body:JSON.stringify({items:nonProps.map(c=>({type:c.type,id:c.id,name:c.name,amount:Number(c.amount),months:c.months||((LICENSE_PACKAGES.find(x=>x.id===c.id)||{}).months)||1}))})});
          STATE.confirmedBalance=Number(data.balance);
          if(data.user){
            if(data.user.license) STATE.license=normalizeLicense(data.user.license);
            if(data.user.sharePlan) STATE.sharePlan=normalizePlan(data.user.sharePlan);
          }
        } else {
          if(STATE.confirmedBalance<nonTotal)throw new Error('Insufficient balance for the selected license/plan');
          STATE.confirmedBalance-=nonTotal;
        }
        nonProps.forEach(c=>{
          if(c.type==='license'){
            const p=LICENSE_PACKAGES.find(x=>x.id===c.id),m=p?p.months:(c.months||1);
            STATE.license=normalizeLicense({id:c.id,months:m,price:c.amount,purchasedAt:now,expiresAt:now+m*30*MS_24H});
            addHistory('License — '+c.name,c.amount,'negative');
          } else if(c.type==='plan'){
            const p=SHARE_PLANS.find(x=>x.id===c.id);
            if(p){ STATE.sharePlan=normalizePlan(p); addHistory((c.name.indexOf('Upgrade')>=0?'Plan upgrade — ':'Plan — ')+p.name,c.amount,'negative'); }
          }
        });
      }
      STATE.cart=[];updateBalanceUI();renderCartUI();renderPortfolioUI();renderPlansUI();updateCartBadge();PROPERTIES.forEach(p=>updateProgressUI(p.id));showPage('sgPageCabinet');
      setTimeout(()=>{document.querySelectorAll('.sg-cabinet__tab').forEach(t=>t.classList.remove('active'));document.querySelectorAll('.sg-cabinet__tab-content').forEach(c=>c.classList.remove('active'));const n=boughtShares?'tabPortfolio':'tabCart';const t=document.querySelector('[data-tab="'+n+'"]'),p=document.getElementById(n);if(t)t.classList.add('active');if(p)p.classList.add('active');},100);
      showToast(boughtShares ? (properties.some(c => Number(c.amount) > 170) ? 'Purchase confirmed! Daily income is available now.' : 'Purchase confirmed! First income unlocks in 7 days (Moscow time).') : 'Purchase confirmed!');
    }catch(err){showToast(err.message||'Purchase failed');}
  }
  /** If license expired — refund price to balance and clear. */
  function checkLicenseExpiry() {
    STATE.license = normalizeLicense(STATE.license);
    if (!STATE.license) return false;
    if (!(STATE.license.expiresAt > 0)) return false;
    if (Date.now() < STATE.license.expiresAt) return false;
    // expired: keep showing expired until server refunds; do not locally invent money
    return false;
  }

  /** Handle checkout form submission. */
  const checkoutForm = document.getElementById('sgCheckoutForm');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', function (e) {
      e.preventDefault();
      completePurchase();
    });
  }

  /* --------------------------------------------------------------
     SECTION 14: AUTHENTICATION
  -------------------------------------------------------------- */
  /** Initialize a new user session with zero balance. */

  async function loadServerAccountData() {
    if (!CONFIG.USE_BACKEND || !getToken()) return;
    try {
      const [portfolioData, depositsData] = await Promise.all([
        apiFetch('/api/v1/portfolio/mine'), apiFetch('/api/v1/deposits/mine')
      ]);
      STATE.portfolio = (portfolioData.portfolio || []).map(p => ({
        id:Number(p.id), propertyId:p.propertyId || p.property_id, name:p.name,
        amount:Number(p.amount), yield:Math.min(50,Number(p.yield)||0),
        purchasedAt:new Date(p.purchasedAt || p.purchased_at).getTime(),
        lastClaimAt:(p.lastClaimAt || p.last_claim_at) ? new Date(p.lastClaimAt || p.last_claim_at).getTime() : null,
        bonusClaimed:!!p.bonusClaimed || !!p.bonus_claimed
      }));
      STATE.confirmedBalance=Number(portfolioData.balance ?? STATE.confirmedBalance)||0;
      const mapped=(depositsData.deposits||[]).map(d => ({
        amount:Number(d.amount), date:new Date(d.created_at).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}),
        status:d.status, method:`${d.currency||CONFIG.CURRENCY} (${d.network||CONFIG.NETWORK})`, serverId:d.id,
        clientRequestId:d.client_request_id, userConfirmedPaid:!!d.user_confirmed_paid, paidAt:d.paid_at||null
      }));
      STATE.pendingDeposits=mapped;
      mapped.forEach(d => {
        if (d.userConfirmedPaid || d.status === 'approved' || d.status === 'rejected') {
          const title = d.status === 'approved'
            ? 'Deposit approved — $' + Number(d.amount).toFixed(2)
            : (d.status === 'rejected' ? 'Deposit rejected — $' + Number(d.amount).toFixed(2) : 'Payment reported — $' + Number(d.amount).toFixed(2));
          if (!STATE.history.some(h => h.title === title && Number(h.amount) === Number(d.amount))) {
            STATE.history.unshift({ title, amount: Number(d.amount), type: d.status === 'approved' ? 'positive' : 'pending', date: d.date });
          }
        }
      });
      renderHistory();
    } catch(e){ console.warn('Could not restore account data',e); }
  }

  async function applyServerUser(user, opts) {
    opts = opts || {};
    STATE.isLoggedIn=true; STATE.user={name:user.name,email:user.email,id:user.id};
    STATE.confirmedBalance=Number(user.balance)||0; STATE.cart=STATE.cart||[]; STATE.history=STATE.history||[];
    STATE.pendingDeposits=STATE.pendingDeposits||[]; STATE.license=normalizeLicense(user.license); STATE.sharePlan=normalizePlan(user.sharePlan);
    STATE.portfolio=Array.isArray(user.portfolio) ? user.portfolio.map(p=>({
      id:Number(p.id),propertyId:p.propertyId||p.property_id,name:p.name,amount:Number(p.amount),yield:Math.min(50,Number(p.yield)||0),
      purchasedAt:new Date(p.purchasedAt||p.purchased_at).getTime(),lastClaimAt:(p.lastClaimAt||p.last_claim_at)?new Date(p.lastClaimAt||p.last_claim_at).getTime():null,bonusClaimed:!!p.bonusClaimed||!!p.bonus_claimed
    })) : [];
    document.getElementById('sgCabinetName').textContent=user.name;
    if (document.getElementById('sgCabinetEmail')) document.getElementById('sgCabinetEmail').textContent=user.email||'';
    await loadServerAccountData();
    updateBalanceUI(); renderHistory(); renderAvatarPicker(); renderPlansUI(); renderPendingList(); renderPortfolioUI();
    const saved=localStorage.getItem('sg_last_page');
    const okPages=['sgPageMain','sgPageCabinet','sgPageCheckout'];
    if (opts.goHome) showPage('sgPageMain');
    else if (opts.restore && okPages.indexOf(saved) !== -1) showPage(saved);
    else if (saved === 'sgPageCabinet') showPage('sgPageCabinet');
    else showPage('sgPageMain');
    if (!opts.restore) showToast('Welcome, '+user.name);
    startLiveAccountSync();
    startPortfolioTimer();
    updateLicenseStatusUI();
  }

  let _liveSyncId = null;
  async function pullLiveAccount() {
    if (!CONFIG.USE_BACKEND || !STATE.isLoggedIn) return;
    try {
      const data = await apiFetch('/api/v1/auth/me');
      if (!data || !data.user) return;
      const u = data.user;
      if (Number.isFinite(Number(u.balance))) STATE.confirmedBalance = Number(u.balance);
      if (u.license) STATE.license = normalizeLicense(u.license);
      if (u.sharePlan) STATE.sharePlan = normalizePlan(u.sharePlan);
      updateBalanceUI();
      updateLicenseStatusUI();
    } catch (e) {}
  }
  function startLiveAccountSync() {
    if (_liveSyncId) clearInterval(_liveSyncId);
    pullLiveAccount();
    _liveSyncId = setInterval(pullLiveAccount, 4000);
  }

  function initUser(name, email) {
    STATE.isLoggedIn = true;
    STATE.user = { name, email };
    STATE.confirmedBalance = 0;
    STATE.cart = [];
    STATE.portfolio = [];
    STATE.history = [];
    STATE.pendingDeposits = [];
    STATE.selectedAvatar = '😊';
    STATE.license = null;
    STATE.sharePlan = null;

    document.getElementById('sgCabinetName').textContent = name;
    document.getElementById('sgCabinetEmail').textContent = email;
    document.getElementById('sgAvatarDisplay').textContent = STATE.selectedAvatar;

    updateBalanceUI();
    renderCartUI();
    renderPortfolioUI();
    renderPlansUI();
    renderPendingList();
    renderHistory();
    renderAvatarPicker();
    showPage('sgPageMain');
  }

  /** Login form handler + live validation. */
  document.getElementById('sgLoginForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearErrs();
    const emailOk = validateEmailField('loginEmail', 'loginEmailErr', true);
    const passOk = validatePassField('loginPass', 'loginPassErr', 6, true);
    const loginInvite = (document.getElementById('loginInvite') && document.getElementById('loginInvite').value || '').trim();
    if (!loginInvite) {
      setErr('loginInviteErr', true);
      markField(document.getElementById('loginInvite'), false);
    } else {
      markField(document.getElementById('loginInvite'), true);
    }
    if (!emailOk || !passOk || !loginInvite) return;
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const pass = document.getElementById('loginPass').value;
    try {
      if (CONFIG.USE_BACKEND) {
        const loc = await visitorPayload();
        const data = await apiFetch('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify({
            email: email,
            password: pass,
            inviteCode: loginInvite,
            clientIp: loc.clientIp || window.__sgPublicIp || '',
            clientCity: loc.clientCity || '',
            clientCountry: loc.clientCountry || ''
          })
        });
        setToken(data.token);
        applyServerUser(data.user);
      } else {
        initUser(email.split('@')[0], email);
      }
    } catch (err) {
      showToast(err.message || 'Login failed');
    }
  });
  document.getElementById('loginEmail').addEventListener('input', function () {
    validateEmailField('loginEmail', 'loginEmailErr', false);
  });
  document.getElementById('loginPass').addEventListener('input', function () {
    validatePassField('loginPass', 'loginPassErr', 6, false);
  });

  const forgotForm = document.getElementById('sgForgotForm');
  if (forgotForm) forgotForm.addEventListener('submit', async function (e) {
    e.preventDefault();
    const code = (document.getElementById('forgotCode').value || '').trim();
    if (!code) { setErr('forgotCodeErr', true); return; }
    try {
      const data = await apiFetch('/api/v1/auth/recover', { method: 'POST', body: JSON.stringify({ inviteCode: code }) });
      document.getElementById('forgotEmailShow').textContent = data.email || '';
      document.getElementById('forgotResult').style.display = 'block';
      document.getElementById('loginEmail').value = data.email || '';
      showToast('Email found for this code');
    } catch (err) {
      showToast(err.message || 'Code not found');
    }
  });
  const resetBtn = document.getElementById('forgotResetBtn');
  if (resetBtn) resetBtn.addEventListener('click', async function () {
    const code = (document.getElementById('forgotCode').value || '').trim();
    const pass = (document.getElementById('forgotNewPass').value || '');
    if (pass.length < 8) { showToast('Password must be at least 8 characters'); return; }
    try {
      const data = await apiFetch('/api/v1/auth/reset-password', { method: 'POST', body: JSON.stringify({ inviteCode: code, newPassword: pass }) });
      document.getElementById('loginEmail').value = data.email || '';
      document.getElementById('loginPass').value = pass;
      if (document.getElementById('loginInvite')) document.getElementById('loginInvite').value = code;
      showToast('Password updated. You can sign in now.');
      ['authLogin','authRegister','authForgot'].forEach(function(x){
        const el = document.getElementById(x);
        if (el) el.style.display = x === 'authLogin' ? 'block' : 'none';
      });
    } catch (err) {
      showToast(err.message || 'Could not reset password');
    }
  });

    /** Registration form handler + live validation. */
  document.getElementById('sgRegForm').addEventListener('submit', async function (e) {
    e.preventDefault();
    clearErrs();
    const name = document.getElementById('regName').value.trim();
    let ok = true;
    if (name.length < 2) {
      setErr('regNameErr', true);
      markField(document.getElementById('regName'), false);
      ok = false;
    } else {
      markField(document.getElementById('regName'), true);
    }
    if (!validateEmailField('regEmail', 'regEmailErr', true)) ok = false;
    if (!validatePhoneField(true)) ok = false;
    if (!validatePassField('regPass', 'regPassErr', 8, true)) ok = false;
    const inviteCode = (document.getElementById('regInvite') && document.getElementById('regInvite').value || '').trim();
    if (!inviteCode) {
      setErr('regInviteErr', true);
      markField(document.getElementById('regInvite'), false);
      ok = false;
    } else {
      markField(document.getElementById('regInvite'), true);
    }
    if (!ok) return;
    const email = document.getElementById('regEmail').value.trim();
    const pass = document.getElementById('regPass').value;
    const phone = typeof getFullPhoneE164 === 'function' ? getFullPhoneE164() : '';
    try {
      if (CONFIG.USE_BACKEND) {
        const loc = await visitorPayload();
        const data = await apiFetch('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            name: name,
            email: email,
            password: pass,
            phone: phone,
            inviteCode: inviteCode,
            clientIp: loc.clientIp || window.__sgPublicIp || '',
            clientCity: loc.clientCity || '',
            clientCountry: loc.clientCountry || ''
          })
        });
        setToken(data.token);
        applyServerUser(data.user, { goHome: true });
      } else {
        showToast('Registration requires a valid one-time code from admin.');
      }
    } catch (err) {
      showToast(err.message || 'Registration failed');
    }
  });
  (function bindAuthLiveValidation() {
    try { populateCountrySelect(); } catch (err) { /* ignore */ }
    const regName = document.getElementById('regName');
    const regEmail = document.getElementById('regEmail');
    const regPhone = document.getElementById('regPhone');
    const regCountry = document.getElementById('regPhoneCountry');
    const regPass = document.getElementById('regPass');
    if (regName) {
      regName.addEventListener('input', function () {
        markField(regName, regName.value.trim().length >= 2 ? true : (regName.value ? false : null));
      });
    }
    if (regEmail) {
      regEmail.addEventListener('input', function () {
        validateEmailField('regEmail', 'regEmailErr', false);
      });
    }
    if (regPhone) regPhone.addEventListener('input', formatRegPhoneInput);
    if (regCountry) {
      regCountry.addEventListener('change', function () {
        if (regPhone) regPhone.value = '';
        formatRegPhoneInput();
      });
    }
    if (regPass) {
      regPass.addEventListener('input', function () {
        updatePasswordMeter();
        validatePassField('regPass', 'regPassErr', 8, false);
      });
    }
    try { formatRegPhoneInput(); } catch (err) { /* ignore */ }
  })();

  /* --------------------------------------------------------------
     SECTION 15: GLOBAL EVENT DELEGATION
     Single listener for 90% of interactive elements.
  -------------------------------------------------------------- */
  async function reportDepositPaid(dep, btn) {
    if (!dep) { showToast('Deposit request not found'); return; }
    if (!dep.serverId && CONFIG.USE_BACKEND) { showToast('Deposit was not saved on server. Submit the request again.'); return; }
    if (dep.userConfirmedPaid) { showToast('Payment has already been reported.'); return; }
    if (btn) btn.disabled = true;
    try {
      const data = CONFIG.USE_BACKEND
        ? await apiFetch('/api/v1/deposits/' + encodeURIComponent(dep.serverId) + '/confirm-paid', {
            method: 'POST',
            body: JSON.stringify({ id: dep.serverId })
          })
        : { userConfirmedPaid: true, paidAt: new Date().toISOString() };
      dep.userConfirmedPaid = true;
      dep.paidAt = data.paidAt || new Date().toISOString();
      addHistory('Payment reported — $' + Number(dep.amount).toFixed(2) + ' (awaiting admin approval)', Number(dep.amount), 'pending');
      const modalBtn = document.getElementById('sgIHavePaidBtn');
      if (modalBtn) {
        modalBtn.style.display = 'none';
        modalBtn.disabled = true;
      }
      const pendingMsg = document.getElementById('sgDepositPendingMsg');
      if (pendingMsg) pendingMsg.classList.remove('show');
      showToast('Moved to History. Balance after admin approval.');
      renderPendingList();
      renderHistory();
    } catch (err) {
      if (btn) btn.disabled = false;
      showToast(err.message || 'Could not report payment');
    }
  }

  document.addEventListener('click', async function (e) {
    const target = e.target;
    const eye = target.closest('[data-eye-for]');
    if (eye) {
      e.preventDefault();
      const inp = document.getElementById(eye.getAttribute('data-eye-for'));
      if (inp) {
        const show = inp.type === 'password';
        inp.type = show ? 'text' : 'password';
        eye.textContent = show ? '🙈' : '👁';
      }
      return;
    }


    const paidHit = target.closest('#sgIHavePaidBtn, [data-confirm-deposit]');
    if (paidHit) {
      e.preventDefault();
      e.stopPropagation();
      const byId = paidHit.dataset.depositId
        ? STATE.pendingDeposits.find(d => String(d.serverId) === String(paidHit.dataset.depositId))
        : null;
      const idx = paidHit.hasAttribute('data-confirm-deposit') ? Number(paidHit.dataset.confirmDeposit) : -1;
      const dep = byId
        || (idx >= 0 ? STATE.pendingDeposits[idx] : null)
        || STATE.pendingDeposits.filter(d => d.status === 'pending' && !d.userConfirmedPaid).slice(-1)[0]
        || STATE.pendingDeposits.filter(d => d.status === 'pending').slice(-1)[0];
      await reportDepositPaid(dep, paidHit);
      return;
    }

    // --- Modal close (X button or overlay click) ---
    if (target.closest('[data-close-modal]') || target.id === 'sgOverlay') {
      closeAllModals();
      return;
    }

    // Clicks inside an open modal must never trigger Home / Account navigation
    if (!target.closest('.sg-modal')) {
      const navEl = target.closest('[data-nav]');
      if (navEl) {
        e.preventDefault();
        const pg = navEl.dataset.nav;
        if (CONFIG.PUBLIC_PAGES.includes(pg) || STATE.isLoggedIn) showPage(pg);
        else gotoSecure(pg);
        document.getElementById('sgNav').classList.remove('open');
        document.getElementById('sgBurger').classList.remove('active');
        return;
      }
    }

    // --- Buy this amount (catalog card investment block) ---
    const buyBtn = target.closest('[data-buy-id]');
    if (buyBtn) {
      e.stopPropagation();
      const id = buyBtn.dataset.buyId;
      buyShare(id, amountFromShares(id));
      return;
    }

    // --- Remove from cart ---
    const remBtn = target.closest('[data-remove-id]');
    if (remBtn) { removeFromCart(remBtn.dataset.removeId); return; }

    // --- Add license package to cart ---
    const licBtn = target.closest('[data-add-license]');
    if (licBtn) {
      addLicenseToCart(licBtn.dataset.addLicense);
      return;
    }

    // --- Add / upgrade share plan to cart ---
    const planBtn = target.closest('[data-add-plan]');
    if (planBtn) {
      addPlanToCart(planBtn.dataset.addPlan);
      return;
    }

    // --- Claim daily income from a portfolio share ---
    const claimBtn = target.closest('[data-claim-id]');
    if (claimBtn) {
      claimShareIncome(claimBtn.dataset.claimId);
      return;
    }

    // --- Ignore clicks inside the slider/chart/buy block so they don't also open the modal ---
    if (target.closest('[data-invest-block]')) { e.stopPropagation(); return; }

    // --- Open property detail modal (card click) ---
    const card = target.closest('.sg-props__card');
    if (card && card.dataset.propId) { openPropertyModal(card.dataset.propId); return; }

    // --- Add to cart from inside property modal (uses that property's current share selection) ---
    if (target.closest('#sgPmCartBtn')) {
      if (STATE.currentPropId) {
        const id = STATE.currentPropId;
        closeAllModals();
        buyShare(id, amountFromShares(id));
      }
      return;
    }

    // --- Gallery carousel: prev / next arrows ---
    if (target.closest('#sgPmGalleryPrev')) { goToGalleryIndex(STATE.galleryIndex - 1); return; }
    if (target.closest('#sgPmGalleryNext')) { goToGalleryIndex(STATE.galleryIndex + 1); return; }

    // --- Gallery carousel: dot indicator ---
    const dot = target.closest('[data-gallery-dot]');
    if (dot) { goToGalleryIndex(Number(dot.dataset.galleryDot)); return; }

    // --- Gallery thumbnail switch ---
    const thumb = target.closest('[data-gallery-thumb]');
    if (thumb) { goToGalleryIndex(Number(thumb.dataset.galleryThumb)); return; }

    // --- Payment method tabs (deposit modal) ---
    const payTab = target.closest('[data-pay-tab]');
    if (payTab) { setPayMethod(payTab.dataset.payTab); return; }

    // --- Catalog horizontal scroll arrows ---
    const scrollBtn = target.closest('[data-scroll-dir]');
    if (scrollBtn) {
      const track = document.getElementById('sgPropsTrack');
      track.scrollBy({ left: scrollBtn.dataset.scrollDir === 'next' ? 330 : -330, behavior: 'smooth' });
      return;
    }

    // --- Cabinet tabs ---
    const tabBtn = target.closest('.sg-cabinet__tab');
    if (tabBtn) {
      document.querySelectorAll('.sg-cabinet__tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.sg-cabinet__tab-content').forEach(c => c.classList.remove('active'));
      tabBtn.classList.add('active');
      document.getElementById(tabBtn.dataset.tab).classList.add('active');
      // Refresh portfolio timers when opening My Shares
      if (tabBtn.dataset.tab === 'tabPortfolio') renderPortfolioUI();
      return;
    }

    // --- Auth page toggles ---
    function showAuthPanel(id) {
      ['authLogin','authRegister','authForgot'].forEach(function(x){
        const el = document.getElementById(x);
        if (el) el.style.display = x === id ? 'block' : 'none';
      });
    }
    if (target.closest('#sgGoRegister')) {
      e.preventDefault();
      clearErrs();
      showAuthPanel('authRegister');
      return;
    }
    if (target.closest('#sgGoLogin') || target.closest('#sgForgotBack')) {
      e.preventDefault();
      clearErrs();
      showAuthPanel('authLogin');
      return;
    }
    if (target.closest('#sgForgotLink')) {
      e.preventDefault();
      clearErrs();
      const res = document.getElementById('forgotResult');
      if (res) res.style.display = 'none';
      showAuthPanel('authForgot');
      return;
    }

    // --- FAQ accordion ---
    const faqQ = target.closest('.sg-faq__question');
    if (faqQ) {
      const item = faqQ.closest('.sg-faq__item');
      const wasOpen = item.classList.contains('open');
      document.querySelectorAll('.sg-faq__item').forEach(i => i.classList.remove('open'));
      if (!wasOpen) item.classList.add('open');
      return;
    }

    // --- Avatar picker ---
    const avOpt = target.closest('[data-avatar]');
    if (avOpt) {
      STATE.selectedAvatar = avOpt.dataset.avatar;
      document.getElementById('sgAvatarDisplay').textContent = STATE.selectedAvatar;
      document.querySelectorAll('.sg-cabinet__avatar-opt').forEach(o =>
        o.classList.toggle('selected', o.dataset.avatar === STATE.selectedAvatar)
      );
      return;
    }

    // --- Deposit / Withdraw modals ---
    if (target.closest('#sgOpenDeposit')) { openDepositModal(); return; }
    if (target.closest('#sgOpenWithdraw') || target.closest('#sgOpenWithdraw')) { e.preventDefault(); e.stopPropagation(); openWithdrawModal(); return; }

    // --- Modal actions ---
    if (target.closest('#sgDepositConfirmBtn')) { e.preventDefault(); handleDeposit(); return; }

    if (target.closest('#sgWithdrawConfirmBtn')) { e.preventDefault(); e.stopPropagation(); handleWithdraw(); return; }

    // --- Copy wallet address ---
    if (target.closest('#sgCopyWalletBtn')) {
      navigator.clipboard.writeText(CONFIG.DEPOSIT_WALLET).catch(() => {});
      target.textContent = 'Copied!';
      setTimeout(() => { if (target) target.textContent = 'Copy'; }, 2000);
      return;
    }

    // --- Checkout (cart → checkout page) ---
    if (target.closest('#sgCheckoutBtn')) {
      if (STATE.cart.length === 0) {
        showToast('Cart is empty');
        return;
      }
      if (STATE.confirmedBalance < cartTotal()) {
        showToast('Insufficient balance — please top up.');
        return;
      }
      buildCheckoutPage();
      showPage('sgPageCheckout');
      return;
    }

    // --- Confirm Purchase (checkout form submit button) ---
    if (target.closest('#sgConfirmPurchaseBtn')) {
      e.preventDefault();
      completePurchase();
      return;
    }

    // --- Logout ---
    if (target.closest('#sgLogoutBtn')) {
      // Release unconfirmed property reservations
      STATE.cart.forEach(c => {
        if ((c.type === 'property' || !c.type) && c.id) {
          STATE.reserved[c.id] = Math.max(0, (STATE.reserved[c.id] || 0) - c.amount);
        }
      });
      STATE.isLoggedIn = false;
      STATE.user = null;
      STATE.confirmedBalance = 0;
      STATE.cart = [];
      STATE.portfolio = [];
      STATE.history = [];
      STATE.pendingDeposits = [];
      STATE.license = null;
      STATE.sharePlan = null;
      updateCartBadge();
      PROPERTIES.forEach(p => updateProgressUI(p.id));
      showPage('sgPageAuth');
      return;
    }

    // --- Logo click ---
    if (target.closest('#sgLogoBtn')) {
      STATE.isLoggedIn ? showPage('sgPageMain') : showPage('sgPageAuth');
      return;
    }

    // --- Mobile burger toggle ---
    if (target.closest('#sgBurger')) {
      document.getElementById('sgNav').classList.toggle('open');
      document.getElementById('sgBurger').classList.toggle('active');
      return;
    }

    // --- Hero CTA scroll ---
    if (target.closest('#sgScrollProps')) {
      document.getElementById('sgPropsSection').scrollIntoView({ behavior:'smooth', block:'start' });
      return;
    }

    // --- Plans nav: go home and scroll to plans ---
    if (target.closest('#sgNavPlans')) {
      e.preventDefault();
      if (!STATE.isLoggedIn) { showPage('sgPageAuth'); return; }
      showPage('sgPageMain');
      setTimeout(() => {
        const sec = document.getElementById('sgPlansSection');
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
      document.getElementById('sgNav').classList.remove('open');
      document.getElementById('sgBurger').classList.remove('active');
      return;
    }
  });

  /** Live slider drag: instantly recompute the amount label + projection chart. */
  document.addEventListener('input', function (e) {
    const slider = e.target.closest('[data-slider-id]');
    if (!slider) return;
    const id = slider.dataset.sliderId;
    STATE.sliderValues[id] = Number(slider.value);
    updateChartAndAmount(id);
  });

  /** Left/Right arrow keys navigate the gallery carousel while the property modal is open. */
  document.addEventListener('keydown', function (e) {
    if (!document.getElementById('sgPropModal').classList.contains('open')) return;
    if (e.key === 'ArrowLeft') goToGalleryIndex(STATE.galleryIndex - 1);
    if (e.key === 'ArrowRight') goToGalleryIndex(STATE.galleryIndex + 1);
  });

  /* --------------------------------------------------------------
     SECTION 16: BOOTSTRAP
     Initialize UI on DOM ready. The catalog/cabinet/checkout pages
     are never shown before login — sgPageAuth is the only landing
     point for a signed-out visitor, matching the hard-gated markup.
  -------------------------------------------------------------- */
  injectAuthCodeFields();
  (function killHomeLicenseTimer(){
    document.querySelectorAll('#sgHomeLicenseTimer,.sg-hero__license').forEach(function(el){ el.remove(); });
  })();
  const wdOpen=document.getElementById('sgOpenWithdraw');
  if(wdOpen) wdOpen.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); openWithdrawModal(); });
  const wdGo=document.getElementById('sgWithdrawConfirmBtn');
  if(wdGo) wdGo.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); handleWithdraw(); });
  renderCards();
  renderPlansUI();
  updateCartBadge();
  startPortfolioTimer();
  trackVisit();

  // Restore session from backend token (keeps user logged in after refresh / deposit)
  (async function restoreSession() {
    if (!CONFIG.USE_BACKEND || !getToken()) {
      showPage(STATE.isLoggedIn ? 'sgPageMain' : 'sgPageAuth');
      return;
    }
    try {
      const data = await apiFetch('/api/v1/auth/me');
      if (data && data.user) {
        await applyServerUser(data.user, { restore: true });
        return;
      }
    } catch (e) {
      setToken('');
    }
    showPage('sgPageAuth');
  })();

})();
