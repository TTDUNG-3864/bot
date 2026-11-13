/**
 * MINEREWARDS - FRONTEND APPLICATION SCRIPT (PHASE 2)
 * Vanilla JavaScript (ES6+), Mobile-First, Telegram Mini App Ready
 */

(function () {
  'use strict';

  // =========================================================================
  // 1. STATE & BUSINESS DATA ADAPTER
  // =========================================================================
  
  const AppState = {
    currentTab: 'tab-mining',
    auth: { token: null, state: 'LOADING', serverClockOffsetMs: 0 },
    user: { id: null, username: null, currentLevel: 1, xpBalance: 0, xpRequired: 96, xpLifetime: 0, availableXu: 0, lockedXu: 0 },
    mining: { sessionId: null, state: 'IDLE', level: 1, speedPerHour: 25, sessionDurationHours: 4, sessionTotalSeconds: 14400, remainingSeconds: 0, sessionEndsAt: null, sessionYieldXu: 100, earnedXp: 5 },
    ads: { watchedToday: null, dailyQuota: 30, rewardXp: 2, enabled: false },
    checkin: { currentStreak: null, todayClaimed: false, nextCycleDay: 1, cycleDays: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, reward: index === 6 ? 200 : 100, status: 'upcoming' })) },
    communityTasks: [],
    referral: { refCode: '', refLink: '', totalF1: 0, qualifiedF1: 0, commissionXu: 0, commissionRatePct: 10, f1List: [] },
    wallet: { currentMethod: 'momo', hasPendingOrder: false, withdrawalEnabled: false, withdrawalHistory: [] }
  };

  let renderMiningStateFn = null;
  let renderLevelsGridFn = null;
  let renderReferralListFn = null;
  let renderWithdrawalHistoryFn = null;
  let connectRetryCount = 0;
  let connectRetryTimer = null;

  // Official 30-Level Specifications Table
  let LEVELS_DATA = [
    { level: 1, speed: 25, yield4h: 100, xpReq: 96 },
    { level: 2, speed: 35, yield4h: 140, xpReq: 112 },
    { level: 3, speed: 45, yield4h: 180, xpReq: 128 },
    { level: 4, speed: 55, yield4h: 220, xpReq: 144 },
    { level: 5, speed: 70, yield4h: 280, xpReq: 216 },
    { level: 6, speed: 100, yield4h: 400, xpReq: 240 },
    { level: 7, speed: 125, yield4h: 500, xpReq: 264 },
    { level: 8, speed: 150, yield4h: 600, xpReq: 288 },
    { level: 9, speed: 200, yield4h: 800, xpReq: 312 },
    { level: 10, speed: 250, yield4h: 1000, xpReq: 360 },
    { level: 11, speed: 350, yield4h: 1400, xpReq: 392 },
    { level: 12, speed: 450, yield4h: 1800, xpReq: 416 },
    { level: 13, speed: 550, yield4h: 2200, xpReq: 444 },
    { level: 14, speed: 650, yield4h: 2600, xpReq: 488 },
    { level: 15, speed: 800, yield4h: 3200, xpReq: 520 },
    { level: 16, speed: 1000, yield4h: 4000, xpReq: 560 },
    { level: 17, speed: 1200, yield4h: 4800, xpReq: 592 },
    { level: 18, speed: 1400, yield4h: 5600, xpReq: 632 },
    { level: 19, speed: 1600, yield4h: 6400, xpReq: 696 },
    { level: 20, speed: 1800, yield4h: 7200, xpReq: 760 },
    { level: 21, speed: 2100, yield4h: 8400, xpReq: 800 },
    { level: 22, speed: 2400, yield4h: 9600, xpReq: 824 },
    { level: 23, speed: 2800, yield4h: 11200, xpReq: 864 },
    { level: 24, speed: 3200, yield4h: 12800, xpReq: 952 },
    { level: 25, speed: 3600, yield4h: 14400, xpReq: 960 },
    { level: 26, speed: 3900, yield4h: 15600, xpReq: 1016 },
    { level: 27, speed: 4200, yield4h: 16800, xpReq: 1056 },
    { level: 28, speed: 4500, yield4h: 18000, xpReq: 1144 },
    { level: 29, speed: 4750, yield4h: 19000, xpReq: 1224 },
    { level: 30, speed: 5000, yield4h: 20000, xpReq: 0 }
  ];

  const API_BASE = String(window.MINEREWARDS_API_BASE || '').replace(/\/$/, '');

  function setBackendStatus(message, state = 'info') {
    const banner = document.getElementById('backend-status-banner');
    const text = document.getElementById('backend-status-text');
    if (text) text.textContent = message;
    if (banner) banner.dataset.state = state;
  }

  function newIdempotencyKey() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (!window.crypto?.getRandomValues) throw new Error('Secure random generator is unavailable');
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async function apiRequest(path, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');
    if (AppState.auth.token && options.auth !== false) headers.set('Authorization', `Bearer ${AppState.auth.token}`);
    try {
      const response = await fetch(`${API_BASE}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
        credentials: 'same-origin'
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401 && AppState.auth.token) {
          clearAuthenticatedState();
          setBackendStatus('Phiên đăng nhập hết hạn. Hãy mở lại Mini App trong Telegram.', 'error');
        }
        const detail = typeof payload.detail === 'string' ? payload.detail : `Máy chủ trả về lỗi ${response.status}.`;
        const error = new Error(detail);
        error.status = response.status;
        throw error;
      }
      return payload;
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Máy chủ phản hồi quá lâu. Hãy thử lại.');
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function applyMiningResponse(response) {
    const serverNow = Date.parse(response.server_now || response.mining?.server_now || '');
    if (Number.isFinite(serverNow)) AppState.auth.serverClockOffsetMs = serverNow - Date.now();
    const session = response.session || response.mining?.session || null;
    const current = LEVELS_DATA.find(item => item.level === AppState.user.currentLevel) || LEVELS_DATA[0];
    if (!session) {
      AppState.mining.sessionId = null;
      AppState.mining.state = 'IDLE';
      AppState.mining.level = AppState.user.currentLevel;
      AppState.mining.speedPerHour = current.speed;
      AppState.mining.sessionYieldXu = current.yield4h;
      AppState.mining.sessionTotalSeconds = 14400;
      AppState.mining.remainingSeconds = 0;
      AppState.mining.sessionEndsAt = null;
      return;
    }
    AppState.mining.sessionId = session.session_id;
    AppState.mining.state = session.state;
    AppState.mining.level = session.level_snapshot;
    AppState.mining.speedPerHour = session.speed_xu_per_hour;
    AppState.mining.sessionYieldXu = session.reward_xu;
    AppState.mining.sessionTotalSeconds = session.duration_seconds;
    AppState.mining.sessionEndsAt = session.ends_at ? Date.parse(session.ends_at) : null;
    AppState.mining.remainingSeconds = AppState.mining.sessionEndsAt
      ? Math.max(0, Math.ceil((AppState.mining.sessionEndsAt - (Date.now() + AppState.auth.serverClockOffsetMs)) / 1000))
      : 0;
    if (session.state === 'CLAIMED') {
      AppState.mining.level = AppState.user.currentLevel;
      AppState.mining.speedPerHour = current.speed;
      AppState.mining.sessionYieldXu = current.yield4h;
      AppState.mining.sessionEndsAt = null;
    }
  }

  function clearAuthenticatedState() {
    AppState.auth.token = null;
    AppState.auth.state = 'UNAUTHENTICATED';
    AppState.user = { id: null, username: null, currentLevel: 1, xpBalance: 0, xpRequired: 96, xpLifetime: 0, availableXu: 0, lockedXu: 0 };
    AppState.mining = { sessionId: null, state: 'IDLE', level: 1, speedPerHour: 25, sessionDurationHours: 4, sessionTotalSeconds: 14400, remainingSeconds: 0, sessionEndsAt: null, sessionYieldXu: 100, earnedXp: 5 };
    AppState.checkin = { currentStreak: null, todayClaimed: false, nextCycleDay: 1, cycleDays: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, reward: index === 6 ? 200 : 100, status: 'upcoming' })) };
    AppState.referral = { refCode: '', refLink: '', totalF1: 0, qualifiedF1: 0, commissionXu: 0, commissionRatePct: 10, f1List: [] };
    AppState.communityTasks = [];
    AppState.wallet = { currentMethod: 'momo', hasPendingOrder: false, withdrawalEnabled: false, withdrawalHistory: [] };
    applyCheckinResponse({ today_claimed: false, current_streak: 0, next_cycle_day: 1, cycle_days: AppState.checkin.cycleDays, next_reward_xu: 100 });
    renderMiningStateFn?.('IDLE');
    renderReferralListFn?.();
    renderWithdrawalHistoryFn?.();
    renderCommunityTasks();
    updateAllUI();
  }

  function applyCheckinResponse(data) {
    AppState.checkin.todayClaimed = Boolean(data.today_claimed);
    AppState.checkin.currentStreak = data.current_streak;
    AppState.checkin.nextCycleDay = data.next_cycle_day;
    AppState.checkin.cycleDays = data.cycle_days || [];
    AppState.checkin.localDate = data.local_date;
    document.querySelectorAll('.checkin-days-matrix .day-slot').forEach(slot => {
      const day = Number(slot.dataset.day);
      const state = AppState.checkin.cycleDays.find(item => item.day === day);
      if (!state) return;
      slot.classList.toggle('completed', state.status === 'completed');
      slot.classList.toggle('upcoming', state.status !== 'completed');
    });
    const label = document.getElementById('btn-checkin-label');
    const button = document.getElementById('btn-claim-checkin');
    if (label) label.textContent = AppState.checkin.todayClaimed ? '✓ Đã nhận thưởng hôm nay' : `Nhận ${formatNumber(data.next_reward_xu)} Xu`;
    if (button) {
      button.disabled = !AppState.auth.token || AppState.checkin.todayClaimed;
      button.classList.toggle('claimed-today', AppState.checkin.todayClaimed);
    }
    const streak = document.getElementById('streak-count');
    if (streak) streak.textContent = `${data.current_streak || 0} ngày`;
  }

  async function refreshBackendData() {
    if (!AppState.auth.token) return;
    const [dashboard, checkin, referral, f1, wallet, withdrawals, tasks, ads, levels] = await Promise.all([
      apiRequest('/api/dashboard'), apiRequest('/api/checkin'), apiRequest('/api/referral'),
      apiRequest('/api/referral/f1'), apiRequest('/api/wallet'), apiRequest('/api/wallet/withdrawals'),
      apiRequest('/api/community/tasks'), apiRequest('/api/rewards/ads/status'), apiRequest('/api/levels')
    ]);
    const user = dashboard.user;
    AppState.user.id = user.id;
    AppState.user.username = user.username;
    AppState.user.currentLevel = user.current_level;
    AppState.user.xpBalance = user.xp_balance;
    AppState.user.xpLifetime = user.xp_lifetime;
    AppState.user.availableXu = user.available_xu;
    AppState.user.lockedXu = user.locked_xu;
    LEVELS_DATA = levels.levels.map(level => ({
      level: level.level, speed: level.speed_xu_per_hour, yield4h: level.reward_xu, xpReq: level.xp_required_to_next
    }));
    const current = LEVELS_DATA.find(item => item.level === user.current_level) || LEVELS_DATA[0];
    AppState.user.xpRequired = current.xpReq;
    applyMiningResponse(dashboard.mining);
    applyCheckinResponse(checkin);
    AppState.referral = {
      refCode: referral.ref_code, refLink: referral.ref_link || '', totalF1: referral.total_f1,
      qualifiedF1: referral.qualified_f1, commissionXu: referral.commission_xu,
      commissionRatePct: referral.commission_rate_pct, f1List: f1.items || []
    };
    AppState.wallet.availableXu = wallet.available_xu;
    AppState.wallet.lockedXu = wallet.locked_xu;
    AppState.wallet.withdrawalEnabled = false;
    AppState.wallet.withdrawalHistory = withdrawals.items || [];
    AppState.communityTasks = tasks.tasks || [];
    AppState.ads.enabled = Boolean(ads.enabled);
    AppState.ads.watchedToday = ads.watched_today;
    if (typeof renderMiningStateFn === 'function') renderMiningStateFn(AppState.mining.state);
    if (typeof renderLevelsGridFn === 'function') renderLevelsGridFn();
    if (typeof renderReferralListFn === 'function') renderReferralListFn();
    if (typeof renderWithdrawalHistoryFn === 'function') renderWithdrawalHistoryFn();
    renderCommunityTasks();
    updateAllUI();
  }

  async function connectBackend() {
    try {
      const health = await apiRequest('/api/health', { auth: false });
      if (!tg?.initData) {
        AppState.auth.state = 'UNAUTHENTICATED';
        const suffix = health.database === 'connected' ? '' : ' Database cần được cấu hình.';
        setBackendStatus(`Mở Mini App từ Telegram để đăng nhập.${suffix}`, health.database === 'connected' ? 'info' : 'error');
        return;
      }
      AppState.auth.state = 'AUTHENTICATING';
      const auth = await apiRequest('/api/auth/telegram', { method: 'POST', auth: false, body: { initData: tg.initData } });
      AppState.auth.token = auth.access_token;
      AppState.auth.state = 'AUTHENTICATED';
      await refreshBackendData();
      connectRetryCount = 0;
      if (connectRetryTimer) clearTimeout(connectRetryTimer);
      connectRetryTimer = null;
      setBackendStatus('Đã kết nối dữ liệu MineRewards. Xu trong ứng dụng là điểm thử nghiệm.', 'success');
    } catch (error) {
      AppState.auth.token = null;
      AppState.auth.state = 'UNAVAILABLE';
      setBackendStatus(error.message || 'Không thể kết nối máy chủ MineRewards.', 'error');
      updateAllUI();
      const retryable = !error.status || ([502, 503, 504].includes(error.status) && !/not configured|configure JWT_SECRET/i.test(error.message));
      if (retryable && connectRetryCount < 1 && !connectRetryTimer) {
        connectRetryCount += 1;
        connectRetryTimer = setTimeout(() => {
          connectRetryTimer = null;
          connectBackend();
        }, 5000);
      }
    }
  }

  const MINER_TIER_STYLES = [
    { name: 'Thợ mỏ tập sự', coat: '#3189A5', trim: '#F4A63A', pants: '#344F62', plate: '#F2C14E', metal: '#D5E0E7' },
    { name: 'Thợ mỏ thành thạo', coat: '#287A68', trim: '#E7B53C', pants: '#2B4152', plate: '#E8F0F4', metal: '#D8E1E7' },
    { name: 'Thợ mỏ chuyên nghiệp', coat: '#3C6790', trim: '#DDA635', pants: '#24384B', plate: '#C9D7E2', metal: '#E8F0F5' },
    { name: 'Thợ mỏ chuyên gia', coat: '#155E75', trim: '#22C8E5', pants: '#1D3446', plate: '#D4E5EB', metal: '#F2C64C' },
    { name: 'Thợ mỏ tinh nhuệ', coat: '#53692C', trim: '#B5EF5B', pants: '#303F34', plate: '#FFE18A', metal: '#F5C84F' },
    { name: 'Thợ mỏ huyền thoại', coat: '#6C4E98', trim: '#FFC928', pants: '#29384A', plate: '#FFE18A', metal: '#FFF0B0' }
  ];

  const MINER_POSES = {
    balanced: { tilt: 0, handX: 75, handY: 56, toolAngle: -28, legs: ['M43 72 39 91 34 97 47 97 51 75Z', 'M57 72 61 91 67 96 55 98 50 75Z'], leftArm: 'M40 48 Q33 51 32 63 L39 66 48 57' },
    stride: { tilt: -4, handX: 77, handY: 48, toolAngle: -48, legs: ['M43 70 31 83 28 96 41 97 50 78Z', 'M57 71 65 81 70 89 80 91 72 96 60 91 51 77Z'], leftArm: 'M40 47 Q30 48 29 57 L36 62 48 56' },
    crouch: { tilt: 7, handX: 73, handY: 64, toolAngle: 12, legs: ['M43 72 34 81 35 90 47 91 52 77Z', 'M57 72 63 80 57 88 69 94 76 89 67 76Z'], leftArm: 'M41 50 Q33 55 35 67 L44 69 50 61' },
    overhead: { tilt: -6, handX: 75, handY: 43, toolAngle: -68, legs: ['M43 72 40 90 35 97 48 98 52 76Z', 'M57 72 60 90 68 96 55 98 51 76Z'], leftArm: 'M40 47 Q31 44 30 53 L38 59 49 55' },
    resting: { tilt: 3, handX: 68, handY: 42, toolAngle: 48, legs: ['M43 72 38 90 32 96 46 98 51 76Z', 'M57 72 63 89 72 93 69 99 56 96 50 76Z'], leftArm: 'M40 48 Q33 52 35 61 L44 64 50 57' },
    wide: { tilt: -2, handX: 78, handY: 58, toolAngle: -8, legs: ['M43 71 31 85 25 94 40 97 51 77Z', 'M58 71 68 85 77 93 70 99 58 93 51 77Z'], leftArm: 'M40 48 Q30 50 28 61 L37 66 49 57' }
  };

  const MINER_LEVEL_DESIGNS = [
    { pose: 'balanced', helmet: 'classic', tool: 'pick', pack: 'pouch', crest: 'bolt' },
    { pose: 'stride', helmet: 'wide', tool: 'hammer', pack: 'satchel', crest: 'star' },
    { pose: 'crouch', helmet: 'ribbed', tool: 'mattock', pack: 'roll', crest: 'diamond' },
    { pose: 'overhead', helmet: 'visor', tool: 'pick', pack: 'canteen', crest: 'shield' },
    { pose: 'resting', helmet: 'sideLamp', tool: 'crystalPick', pack: 'pouch', crest: 'gem' },
    { pose: 'wide', helmet: 'doubleRidge', tool: 'hammer', pack: 'backpack', crest: 'bolt' },
    { pose: 'crouch', helmet: 'visor', tool: 'mattock', pack: 'tank', crest: 'chevron' },
    { pose: 'balanced', helmet: 'wide', tool: 'crystalPick', pack: 'satchel', crest: 'star' },
    { pose: 'stride', helmet: 'sideLamp', tool: 'doublePick', pack: 'toolRoll', crest: 'diamond' },
    { pose: 'overhead', helmet: 'reinforced', tool: 'hammer', pack: 'tank', crest: 'shield' },
    { pose: 'resting', helmet: 'classic', tool: 'doublePick', pack: 'backpack', crest: 'crest' },
    { pose: 'wide', helmet: 'reinforced', tool: 'crystalPick', pack: 'toolRoll', crest: 'bolt' },
    { pose: 'stride', helmet: 'visor', tool: 'mattock', pack: 'tank', crest: 'diamond' },
    { pose: 'balanced', helmet: 'doubleRidge', tool: 'heavyPick', pack: 'crystalPack', crest: 'shield' },
    { pose: 'crouch', helmet: 'sideLamp', tool: 'hammer', pack: 'backpack', crest: 'star' },
    { pose: 'overhead', helmet: 'reinforced', tool: 'heavyPick', pack: 'tank', crest: 'gear' },
    { pose: 'resting', helmet: 'doubleRidge', tool: 'crystalPick', pack: 'crystalPack', crest: 'gem' },
    { pose: 'stride', helmet: 'visor', tool: 'mattock', pack: 'toolRoll', crest: 'chevron' },
    { pose: 'wide', helmet: 'reinforced', tool: 'doublePick', pack: 'tank', crest: 'gear' },
    { pose: 'balanced', helmet: 'crest', tool: 'heavyPick', pack: 'crystalPack', crest: 'shield' },
    { pose: 'crouch', helmet: 'crest', tool: 'crystalPick', pack: 'backpack', crest: 'star' },
    { pose: 'overhead', helmet: 'reinforced', tool: 'doublePick', pack: 'tank', crest: 'bolt' },
    { pose: 'stride', helmet: 'crystalBrow', tool: 'heavyPick', pack: 'crystalPack', crest: 'gem' },
    { pose: 'resting', helmet: 'crest', tool: 'mattock', pack: 'mantle', crest: 'gear' },
    { pose: 'wide', helmet: 'crystalBrow', tool: 'crystalPick', pack: 'mantle', crest: 'crest' },
    { pose: 'balanced', helmet: 'legendary', tool: 'heavyPick', pack: 'crystalPack', crest: 'gem' },
    { pose: 'stride', helmet: 'legendary', tool: 'crystalPick', pack: 'mantle', crest: 'bolt' },
    { pose: 'crouch', helmet: 'crystalBrow', tool: 'doublePick', pack: 'crystalPack', crest: 'diamond' },
    { pose: 'overhead', helmet: 'legendary', tool: 'mattock', pack: 'mantle', crest: 'shield' },
    { pose: 'wide', helmet: 'legendary', tool: 'legendary', pack: 'legendaryMantle', crest: 'crown' }
  ];

  function renderMinerCharacter(item) {
    const design = MINER_LEVEL_DESIGNS[item.level - 1];
    const tierIndex = Math.min(5, Math.floor((item.level - 1) / 5));
    const tier = MINER_TIER_STYLES[tierIndex];
    const pose = MINER_POSES[design.pose];

    const helmetShapes = {
      classic: '<path d="M39 25Q40 13 52 13T65 25L64 29H40Z"/><path d="M37 26H67V30H37Z"/>',
      wide: '<path d="M38 25Q40 12 52 12T66 25V28H38Z"/><path d="M34 26Q52 24 70 27L68 31H36Z"/>',
      ribbed: '<path d="M40 25Q41 13 52 13T64 25V29H40Z"/><path d="M37 27H67V30H37Z"/><path d="M52 14V25M46 16V25M58 16V25" fill="none" stroke="${tier.metal}" stroke-width="1.6"/>',
      visor: '<path d="M39 24Q40 12 52 12T65 24V28H39Z"/><path d="M39 24H65L62 31H41Z" fill="${tier.metal}"/><path d="M42 26H62" fill="none" stroke="${tier.trim}" stroke-width="1.5"/>',
      sideLamp: '<path d="M40 25Q42 14 52 14T64 25V28H40Z"/><path d="M37 26H66V30H37Z"/><rect x="60" y="20" width="7" height="6" rx="2"/>',
      doubleRidge: '<path d="M38 25Q40 12 52 12T66 25V28H38Z"/><path d="M36 27H68V30H36Z"/><path d="M47 14 49 24M57 14 55 24" fill="none" stroke="${tier.trim}" stroke-width="2"/>',
      reinforced: '<path d="M39 24Q40 11 52 11T65 24V28H39Z"/><path d="M35 26H69V31H35Z"/><path d="M43 16 52 12 61 16V24H43Z" fill="none" stroke="${tier.metal}" stroke-width="1.4"/>',
      crest: '<path d="M39 25Q40 12 52 12T65 25V29H39Z"/><path d="M36 27H68V31H36Z"/><path d="M52 13 56 7 59 15" fill="${tier.trim}" stroke="${tier.trim}" stroke-width="1.5"/>',
      crystalBrow: '<path d="M39 25Q40 11 52 11T65 25V29H39Z"/><path d="M35 27H69V31H35Z"/><path d="M52 12 56 19 52 25 48 19Z" fill="${tier.trim}"/>',
      legendary: '<path d="M39 24Q40 10 52 10T65 24V28H39Z"/><path d="M33 26H71V31H33Z"/><path d="M52 10 57 2 60 14 52 19 44 14 47 2Z" fill="${tier.trim}" stroke="${tier.metal}" stroke-width="1.3"/>'
    };

    const packs = {
      pouch: '<path d="M29 48 38 45 40 67 30 69Z"/><path d="M31 54H38M31 59H39" fill="none" stroke="${tier.metal}" stroke-width="1.3"/>',
      satchel: '<path d="M28 42Q33 39 40 46L38 66 29 68Z"/><path d="M30 50Q34 47 39 50M31 57H38" fill="none" stroke="${tier.trim}" stroke-width="1.8"/>',
      roll: '<path d="M29 44 38 42 40 67 30 68Z"/><path d="M30 47 39 45M30 52 39 50M31 59H39" fill="none" stroke="${tier.metal}" stroke-width="1.5"/>',
      canteen: '<path d="M30 48Q34 43 39 48V64Q35 68 30 64Z"/><path d="M33 46V43H37V47M32 54H38" fill="none" stroke="${tier.metal}" stroke-width="1.5"/>',
      backpack: '<path d="M27 43Q33 39 41 45V67H29Q27 57 27 43Z"/><rect x="29" y="51" width="10" height="9" rx="2" fill="${tier.trim}"/><path d="M31 46V42M37 46V42" fill="none" stroke="${tier.metal}" stroke-width="1.5"/>',
      tank: '<rect x="27" y="43" width="6" height="23" rx="3"/><rect x="35" y="41" width="7" height="25" rx="3.5"/><path d="M31 45Q42 39 43 51M30 59H41" fill="none" stroke="${tier.trim}" stroke-width="1.8"/>',
      toolRoll: '<path d="M28 45 40 42V54H29Z"/><path d="M30 47V54M34 46V53M38 45V52M30 59H40V67H30Z" fill="none" stroke="${tier.metal}" stroke-width="1.5"/>',
      crystalPack: '<path d="M28 47 34 40 41 48 40 67 29 68Z"/><path d="M34 44 38 52 34 59 31 52Z" fill="${tier.trim}" stroke="${tier.metal}" stroke-width="1"/>',
      mantle: '<path d="M37 42 30 48 28 82 37 77 42 51Z"/><path d="M30 55 38 58" fill="none" stroke="${tier.trim}" stroke-width="2"/>',
      legendaryMantle: '<path d="M37 40 29 47 24 86 38 79 43 49Z"/><path d="M29 55 38 58M27 67 36 69" fill="none" stroke="${tier.trim}" stroke-width="2"/><path d="M24 86 30 82 35 88 29 92Z" fill="${tier.metal}"/>'
    };

    const toolHeads = {
      pick: '<path d="M-17-27Q0-35 17-27L14-22Q0-28-14-21Z"/>',
      hammer: '<path d="M-14-29H13Q18-29 18-24V-21H-14Z"/><rect x="9" y="-31" width="6" height="12" rx="2"/>',
      mattock: '<path d="M-18-25Q-7-33 2-27L12-31 18-27 3-21Q-6-25-15-20Z"/>',
      crystalPick: '<path d="M-17-26 0-32 16-25 8-20 0-24-12-20Z"/><path d="M-17-26 0-32 0-25-12-20Z" fill="${tier.metal}"/>',
      doublePick: '<path d="M-19-26Q-9-33 0-27Q9-33 19-26L15-21Q7-26 0-22Q-7-26-15-21Z"/>',
      heavyPick: '<path d="M-20-28Q-8-37 2-29L17-31 20-25 2-23Q-8-28-17-22Z"/><path d="M-18-27 0-31V-25L-15-22Z" fill="${tier.metal}"/>',
      legendary: '<path d="M-22-27 0-36 23-27 15-21 0-27-15-21Z"/><path d="M0-36 7-28 0-24-7-28Z" fill="${tier.trim}"/><path d="M-20-27 0-34V-29L-16-23Z" fill="${tier.metal}"/>'
    };

    const crests = {
      bolt: 'M-2-7H3L0-1H4L-3 7-1 1H-5Z',
      star: 'M0-7 2-2 7 0 2 2 0 7-2 2-7 0-2-2Z',
      diamond: 'M0-7 6 0 0 7-6 0Z',
      shield: 'M-6-6H6V1Q4 5 0 7-4 5-6 1Z',
      gem: 'M-6-3 0-7 6-3 4 5 0 8-4 5Z',
      chevron: 'M-7-4 0 0 7-4 7 0 0 5-7 0Z',
      crest: 'M-6-6H6V1L0 7-6 1Z',
      gear: 'M-2-7H2L3-4 6-5 8-2 6 0 8 2 6 5 3 4 2 7H-2L-3 4-6 5-8 2-6 0-8-2-6-5-3-4Z',
      crown: 'M-8-5-4-1 0-8 4-1 8-5 6 4H-6Z'
    };

    const helmet = helmetShapes[design.helmet].replaceAll('${tier.metal}', tier.metal).replaceAll('${tier.trim}', tier.trim);
    const pack = packs[design.pack].replaceAll('${tier.metal}', tier.metal).replaceAll('${tier.trim}', tier.trim);
    const toolHead = toolHeads[design.tool].replaceAll('${tier.metal}', tier.metal).replaceAll('${tier.trim}', tier.trim);
    const torsoByTier = [
      `<path d="M39 43Q52 38 65 43L68 72Q52 79 36 72Z" fill="${tier.coat}" stroke="${tier.pants}" stroke-width="2"/><path d="M43 43 47 72M60 43 57 72" stroke="${tier.trim}" stroke-width="3"/><rect x="46" y="55" width="12" height="10" rx="2" fill="${tier.plate}"/>`,
      `<path d="M39 43Q52 38 65 43L68 72Q52 79 36 72Z" fill="${tier.coat}" stroke="${tier.pants}" stroke-width="2"/><path d="M39 51H66M38 62H67" stroke="${tier.plate}" stroke-width="3"/><path d="M44 43 49 51 54 43M54 43 59 51 64 43" fill="none" stroke="${tier.trim}" stroke-width="2"/><rect x="47" y="56" width="10" height="10" rx="2" fill="${tier.pants}"/>`,
      `<path d="M39 43 45 40H59L65 43 69 72 52 79 35 72Z" fill="${tier.coat}" stroke="${tier.plate}" stroke-width="2.4"/><path d="M43 45 52 52 61 45 64 69 52 74 40 69Z" fill="${tier.plate}"/><path d="M46 48 52 54 58 48M52 54V69" fill="none" stroke="${tier.trim}" stroke-width="2.2"/>`,
      `<path d="M40 42 46 39H58L64 42 69 72 52 79 35 72Z" fill="${tier.coat}" stroke="${tier.trim}" stroke-width="2.5"/><path d="M42 46 52 51 62 46 64 68 52 74 40 68Z" fill="${tier.plate}"/><path d="M44 49 52 55 60 49M44 63H60M52 55V70" fill="none" stroke="${tier.trim}" stroke-width="2.4"/>`,
      `<path d="M39 42 45 38H59L66 43 70 71 52 80 34 71Z" fill="${tier.coat}" stroke="${tier.trim}" stroke-width="3"/><path d="M41 46 52 50 63 46 66 68 52 75 38 68Z" fill="${tier.plate}"/><path d="M42 49 52 56 62 49M43 65H61" fill="none" stroke="${tier.trim}" stroke-width="2.5"/><path d="M36 45 29 49 33 59 40 56M68 45 75 49 71 59 64 56Z" fill="${tier.plate}" stroke="${tier.trim}" stroke-width="1.7"/>`,
      `<path d="M38 42 45 37H59L67 42 72 72 52 81 32 72Z" fill="${tier.coat}" stroke="${tier.trim}" stroke-width="3.2"/><path d="M40 45 52 50 64 45 68 68 52 76 36 68Z" fill="${tier.plate}"/><path d="M43 48 52 56 61 48M40 64H64M52 56V72" fill="none" stroke="${tier.trim}" stroke-width="3"/><path d="M36 46 28 50 32 61 40 57M68 46 76 50 72 61 64 57Z" fill="${tier.plate}" stroke="${tier.trim}" stroke-width="2"/>`
    ][tierIndex];
    const cape = design.pack.includes('mantle') ? '<path d="M37 43 30 48 24 86 39 78 44 52Z" fill="${tier.coat}" stroke="${tier.trim}" stroke-width="1.5"/>' : '';
    const aura = tierIndex === 5 ? `<path d="M31 36Q23 54 30 77M73 36Q81 54 74 77" fill="none" stroke="${tier.trim}" stroke-width="2" stroke-dasharray="2 4" opacity=".72"/>` : (tierIndex === 4 ? `<path d="M34 45Q27 57 34 70M70 45Q77 57 70 70" fill="none" stroke="${tier.trim}" stroke-width="1.5" opacity=".58"/>` : '');
    const facePlate = tierIndex >= 3 ? `<path d="M43 30Q52 35 61 30L59 38Q52 43 45 38Z" fill="${tier.plate}" opacity=".9"/>` : '<path d="M44 32Q52 35 60 32Q57 41 52 42 47 41 44 32Z" fill="#70422B"/>';

    return `<svg class="level-miner-illustration tier-${tierIndex + 1} pose-${design.pose}" viewBox="0 0 104 108" aria-hidden="true" focusable="false" data-miner-design="${item.level}-${design.pose}-${design.helmet}-${design.tool}-${design.pack}">
      <ellipse cx="52" cy="100" rx="24" ry="4" fill="#1D3446" opacity=".2"/>
      ${aura}${cape}
      <g class="level-miner-pack" fill="${tier.coat}" stroke="${tier.pants}" stroke-width="1.5">${pack}</g>
      <path d="${pose.legs[0]}" fill="${tier.pants}" stroke="#172C3B" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="${pose.legs[1]}" fill="${tier.pants}" stroke="#172C3B" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M33 95H47L47 99H31ZM56 95H70L74 99H56Z" fill="${tier.metal}" stroke="#172C3B" stroke-width="1.4"/>
      <g class="level-miner-body" transform="rotate(${pose.tilt} 52 60)">
        ${torsoByTier}
        <path d="${pose.leftArm}" fill="none" stroke="${tier.coat}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="${pose.leftArm}" fill="none" stroke="${tier.trim}" stroke-width="2" stroke-linecap="round"/>
        <path d="M64 48Q69 47 ${pose.handX - 1} ${pose.handY - 2}" fill="none" stroke="${tier.coat}" stroke-width="8" stroke-linecap="round"/>
        <g class="level-miner-tool" transform="translate(${pose.handX} ${pose.handY}) rotate(${pose.toolAngle})">
          <rect x="-2.6" y="-31" width="5.2" height="44" rx="2.4" fill="#8A5B2D" stroke="#56371E" stroke-width="1"/>
          <path d="M-16-28 0-32 16-28" fill="none" stroke="${tier.metal}" stroke-width="4" stroke-linecap="round"/>
          <g fill="${tier.metal}" stroke="#506171" stroke-width="1">${toolHead}</g>
          <circle cx="0" cy="-27" r="1.6" fill="${tier.trim}"/>
        </g>
        <circle cx="${pose.handX}" cy="${pose.handY}" r="4.1" fill="#E7AD78" stroke="#A96237" stroke-width="1"/>
        <path d="M44 27Q44 18 52 18T60 27V35Q60 42 52 43 44 42 44 35Z" fill="#E9B88C" stroke="#8A5537" stroke-width="1.3"/>
        ${facePlate}
        <circle cx="48" cy="28" r="1.1" fill="#263746"/><circle cx="56" cy="28" r="1.1" fill="#263746"/>
        <g fill="${tier.trim}" stroke="#6D5524" stroke-width="1">${helmet}</g>
        <rect x="58" y="20" width="6" height="5" rx="1.6" fill="#FFF6C9" stroke="${tier.trim}" stroke-width="1"/>
        <path d="M61 22.5 75 19V27L62 25Z" fill="#FFE18A" opacity=".28"/>
        <path d="${crests[design.crest]}" transform="translate(52 60) scale(.7)" fill="${tier.trim}" stroke="${tier.metal}" stroke-width=".8"/>
        <path d="M38 72H66" stroke="${tier.trim}" stroke-width="2"/>
      </g>
    </svg>`;
  }

  // =========================================================================
  // 2. TELEGRAM MINI APP INTEGRATION & HAPTICS
  // =========================================================================
  const tg = window.Telegram?.WebApp;
  const THEME_STORAGE_KEY = 'minerewards-theme';
  const THEME_PALETTES = {
    light: { header: '#EDF3F7', background: '#EDF3F7', bottom: '#F9FCFE' },
    dark: { header: '#101820', background: '#101820', bottom: '#142431' }
  };
  let activeTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  let telegramAppVisible = true;
  let resumeMiningCountdown = null;
  let pauseMiningCountdown = null;

  function applyTheme(theme, persist = true, syncTelegram = true) {
    activeTheme = theme === 'dark' ? 'dark' : 'light';
    const root = document.documentElement;
    root.dataset.theme = activeTheme;
    root.style.colorScheme = activeTheme;

    const isDark = activeTheme === 'dark';
    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      toggle.setAttribute('aria-pressed', String(isDark));
      toggle.setAttribute('aria-label', isDark ? 'Bật giao diện sáng' : 'Bật giao diện tối');
      toggle.title = isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối';
    }

    const themeMeta = document.getElementById('theme-color-meta');
    if (themeMeta) themeMeta.content = THEME_PALETTES[activeTheme].header;

    if (persist) {
      try { localStorage.setItem(THEME_STORAGE_KEY, activeTheme); } catch (error) {}
    }
    if (syncTelegram) applyTelegramTheme();
  }

  function initThemeToggle() {
    let selectedTheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    try {
      const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
      if (storedTheme === 'light' || storedTheme === 'dark') selectedTheme = storedTheme;
    } catch (error) {}

    applyTheme(selectedTheme, false, false);
    const toggle = document.getElementById('theme-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
      triggerHaptic('light');
      applyTheme(activeTheme === 'light' ? 'dark' : 'light');
    });
  }

  function initTelegramMiniApp() {
    document.addEventListener('visibilitychange', () => setAppVisibility());

    if (!tg) {
      console.log('Running in standard browser (Telegram SDK fallback active)');
      updateSafeAreaInsets();
      return;
    }

    try {
      tg.ready();
      tg.expand();

      tg.onEvent('themeChanged', applyTelegramTheme);
      tg.onEvent('viewportChanged', updateSafeAreaInsets);
      tg.onEvent('visibilityChanged', (event) => setAppVisibility(event?.isVisible !== false));

      updateSafeAreaInsets();
      applyTelegramTheme();
      setAppVisibility(true);
    } catch (e) {
      console.warn('Telegram initialization note:', e);
    }
  }

  function applyTelegramTheme() {
    document.documentElement.style.colorScheme = activeTheme;
    const palette = THEME_PALETTES[activeTheme];
    try { if (typeof tg?.setHeaderColor === 'function') tg.setHeaderColor(palette.header); } catch (error) {}
    try { if (typeof tg?.setBackgroundColor === 'function') tg.setBackgroundColor(palette.background); } catch (error) {}
    try { if (typeof tg?.setBottomBarColor === 'function') tg.setBottomBarColor(palette.bottom); } catch (error) {}
  }

  function updateSafeAreaInsets() {
    const top = tg ? Math.max(0, (tg.contentSafeAreaInset?.top || 0) + (tg.safeAreaInset?.top || 0)) : 0;
    const bottom = tg ? Math.max(0, (tg.contentSafeAreaInset?.bottom || 0) + (tg.safeAreaInset?.bottom || 0)) : 0;
    const root = document.documentElement;
    root.style.setProperty('--safe-top', `calc(env(safe-area-inset-top, 0px) + ${top}px)`);
    root.style.setProperty('--safe-bottom', `calc(env(safe-area-inset-bottom, 0px) + ${bottom}px)`);

    const viewportHeight = window.visualViewport?.height || tg?.viewportHeight || window.innerHeight;
    if (Number.isFinite(viewportHeight) && viewportHeight > 0) {
      root.style.setProperty('--app-height', `${Math.round(viewportHeight)}px`);
    }
  }

  function setAppVisibility(isTelegramVisible) {
    if (typeof isTelegramVisible === 'boolean') telegramAppVisible = isTelegramVisible;
    const isVisible = !document.hidden && telegramAppVisible;
    document.getElementById('app')?.classList.toggle('is-app-hidden', !isVisible);

    if (isVisible) resumeMiningCountdown?.();
    else pauseMiningCountdown?.();
  }

  function triggerHaptic(type = 'light') {
    if (type === 'info') return;
    if (tg?.HapticFeedback) {
      try {
        switch (type) {
          case 'light': tg.HapticFeedback.impactOccurred('light'); break;
          case 'medium': tg.HapticFeedback.impactOccurred('medium'); break;
          case 'heavy': tg.HapticFeedback.impactOccurred('heavy'); break;
          case 'success': tg.HapticFeedback.notificationOccurred('success'); break;
          case 'error': tg.HapticFeedback.notificationOccurred('error'); break;
          case 'warning': tg.HapticFeedback.notificationOccurred('warning'); break;
        }
      } catch (err) {}
    } else if (navigator.vibrate) {
      if (type === 'heavy' || type === 'error') navigator.vibrate(40);
      else if (type === 'success') navigator.vibrate([20, 30, 20]);
      else navigator.vibrate(15);
    }
  }

  // =========================================================================
  // 3. TOAST NOTIFICATION COMPONENT
  // =========================================================================
  let activeToast = null;
  let activeToastTimer = null;
  let toastRemovalTimer = null;
  let lastToastKey = '';
  let lastToastAt = 0;

  function showToast(message, type = 'success', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const text = String(message ?? '');
    const toastKey = `${type}:${text}`;
    const now = Date.now();
    if (toastKey === lastToastKey && now - lastToastAt < 900) return;
    lastToastKey = toastKey;
    lastToastAt = now;

    clearTimeout(activeToastTimer);
    clearTimeout(toastRemovalTimer);
    activeToast?.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconSvg = '';
    if (type === 'success') {
      iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (type === 'error') {
      iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    } else {
      iconSvg = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconSvg;
    const messageNode = document.createElement('span');
    messageNode.textContent = text;
    toast.append(icon, messageNode);
    container.appendChild(toast);
    activeToast = toast;

    activeToastTimer = setTimeout(() => {
      toast.classList.add('is-leaving');
      toastRemovalTimer = setTimeout(() => {
        toast.remove();
        if (activeToast === toast) activeToast = null;
      }, 180);
    }, duration);
  }

  // =========================================================================
  // 4. NUMBER & TIME HELPERS
  // =========================================================================
  function formatNumber(num) {
    return new Intl.NumberFormat('vi-VN').format(num);
  }

  function formatTime(totalSeconds) {
    if (totalSeconds <= 0) return '00:00:00';
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  // =========================================================================
  // 5. GLOBAL TAB NAVIGATION
  // =========================================================================
  function initTabNavigation() {
    const navButtons = document.querySelectorAll('.nav-item');
    const tabPanes = document.querySelectorAll('.tab-pane');
    let transitionTimer = null;

    tabPanes.forEach((pane) => pane.setAttribute('aria-hidden', pane.id === AppState.currentTab ? 'false' : 'true'));

    navButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTabId = btn.getAttribute('data-tab');
        if (!targetTabId || targetTabId === AppState.currentTab) return;

        triggerHaptic('light');
        clearTimeout(transitionTimer);

        const currentPane = document.getElementById(AppState.currentTab);
        const nextPane = document.getElementById(targetTabId);
        if (!nextPane) return;

        tabPanes.forEach((pane) => pane.classList.remove('is-leaving'));
        if (currentPane) {
          currentPane.classList.remove('active');
          currentPane.classList.add('is-leaving');
          currentPane.setAttribute('aria-hidden', 'true');
        }

        navButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        navButtons.forEach((b) => {
          if (b === btn) b.setAttribute('aria-current', 'page');
          else b.removeAttribute('aria-current');
        });

        tabPanes.forEach((pane) => pane.classList.remove('active'));
        nextPane.classList.add('active');
        nextPane.setAttribute('aria-hidden', 'false');

        AppState.currentTab = targetTabId;
        window.scrollTo(0, 0);
        transitionTimer = setTimeout(() => currentPane?.classList.remove('is-leaving'), 180);
      });
    });
  }

  // =========================================================================
  // 6. CENTRALIZED XP PROGRESSION ENGINE & TAB 1: MINING ENGINE
  // =========================================================================
  let miningCountdownTimer = null;

  // XP is authoritative on the server; this compatibility hook cannot mutate balances.
  function addXp() {
    showToast('XP được cập nhật từ máy chủ sau giao dịch hợp lệ.', 'info');
  }

  function initMiningTab() {
    const statusLabel = document.getElementById('mining-state-label');
    const actionBtn = document.getElementById('btn-mining-action');
    const btnText = document.getElementById('mining-btn-text');
    const btnIcon = document.getElementById('mining-btn-icon');
    const progressFill = document.getElementById('mining-progress-fill');
    const countdownText = document.getElementById('mining-countdown-text');
    const summaryStatusVal = document.getElementById('summary-status-val');
    const caveScene = document.getElementById('cave-scene');
    const miningStatusPill = document.getElementById('mining-status-pill');

    function stopMiningCountdown() {
      if (miningCountdownTimer !== null) {
        clearInterval(miningCountdownTimer);
        miningCountdownTimer = null;
      }
    }

    function syncMiningCountdown() {
      if (AppState.mining.state !== 'MINING') return false;
      const endAt = Number(AppState.mining.sessionEndsAt);
      const remaining = Math.max(0, Math.ceil((endAt - (Date.now() + AppState.auth.serverClockOffsetMs)) / 1000));
      AppState.mining.remainingSeconds = remaining;
      countdownText.textContent = `Còn lại: ${formatTime(remaining)}`;

      const total = Math.max(1, AppState.mining.sessionTotalSeconds);
      const elapsed = total - remaining;
      const pct = Math.min(100, Math.max(0, Math.round((elapsed / total) * 100)));
      progressFill.style.width = `${pct}%`;

      if (remaining === 0) {
        renderMiningState('COMPLETED_UNCLAIMED');
        return false;
      }
      return true;
    }

    function startMiningCountdown() {
      if (miningCountdownTimer !== null || document.hidden || !telegramAppVisible) return;
      if (!syncMiningCountdown()) return;
      miningCountdownTimer = setInterval(syncMiningCountdown, 1000);
    }

    pauseMiningCountdown = stopMiningCountdown;
    resumeMiningCountdown = () => {
      if (AppState.mining.state === 'MINING') startMiningCountdown();
    };

    function renderMiningState(state) {
      AppState.mining.state = state;
      caveScene?.classList.toggle('is-mining', state === 'MINING');
      miningStatusPill?.classList.toggle('is-mining', state === 'MINING');
      stopMiningCountdown();

      if (state === 'IDLE') {
        AppState.mining.sessionEndsAt = null;
        statusLabel.textContent = 'ĐANG DỪNG';
        actionBtn.className = 'btn btn-primary btn-mining-action idle-state';
        btnText.textContent = 'KÍCH HOẠT ĐÀO (4 GIỜ)';
        btnIcon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
        progressFill.style.width = '0%';
        countdownText.textContent = 'Chưa bắt đầu';
        summaryStatusVal.innerHTML = '<span class="dot-indicator gray"></span><span>Đang dừng</span>';
      } 
      else if (state === 'MINING') {
        statusLabel.textContent = 'ĐANG ĐÀO';
        actionBtn.className = 'btn btn-primary btn-mining-action active-mining-state';
        btnText.textContent = 'ĐANG ĐÀO...';
        btnIcon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
        summaryStatusVal.innerHTML = '<span class="dot-indicator green"></span><span>Đang đào</span>';

        if (typeof AppState.mining.sessionEndsAt === 'number' && Number.isFinite(AppState.mining.sessionEndsAt)) {
          if (syncMiningCountdown()) startMiningCountdown();
        } else {
          countdownText.textContent = 'Đang chờ thời gian từ máy chủ';
        }
      } 
      else if (state === 'COMPLETED_UNCLAIMED') {
        statusLabel.textContent = 'CHỜ NHẬN';
        actionBtn.className = 'btn btn-primary btn-mining-action completed-claim-state';
        btnText.textContent = `NHẬN ${AppState.mining.sessionYieldXu} XU`;
        btnIcon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
        progressFill.style.width = '100%';
        countdownText.textContent = 'Phiên đào hoàn tất';
        summaryStatusVal.innerHTML = '<span class="dot-indicator gold"></span><span>Chờ nhận</span>';
      } 
      else if (state === 'CLAIMED') {
        AppState.mining.sessionEndsAt = null;
        statusLabel.textContent = 'ĐÃ NHẬN';
        actionBtn.className = 'btn btn-primary btn-mining-action idle-state';
        btnText.textContent = 'BẮT ĐẦU PHIÊN MỚI';
        btnIcon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>';
        progressFill.style.width = '100%';
        countdownText.textContent = 'Sẵn sàng phiên mới';
        summaryStatusVal.innerHTML = '<span class="dot-indicator green"></span><span>Sẵn sàng</span>';
      }
      actionBtn.disabled = !AppState.auth.token || state === 'MINING';
    }

    let miningActionLocked = false;
    actionBtn.addEventListener('click', async () => {
      if (!AppState.auth.token) {
        showToast('Hãy đăng nhập từ Mini App trong Telegram.', 'info');
        return;
      }
      if (miningActionLocked) return;
      miningActionLocked = true;
      actionBtn.disabled = true;
      triggerHaptic('medium');

      try {
        if (AppState.mining.state === 'IDLE' || AppState.mining.state === 'CLAIMED') {
          const result = await apiRequest('/api/mining/start', {
            method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() }
          });
          applyMiningResponse(result);
          renderMiningStateFn(AppState.mining.state);
          showToast('Phiên đào 4 giờ đã được máy chủ bắt đầu.', 'success');
        } else if (AppState.mining.state === 'COMPLETED_UNCLAIMED') {
          const result = await apiRequest('/api/mining/claim', {
            method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() },
            body: { session_id: AppState.mining.sessionId }
          });
          triggerHaptic('success');
          await refreshBackendData();
          showToast(`Đã nhận ${formatNumber(result.session.reward_xu)} Xu và 5 XP từ máy chủ.`, 'success');
        }
      } catch (error) {
        showToast(error.message || 'Không thể hoàn tất thao tác đào.', 'error', 4000);
        try { await refreshBackendData(); } catch (_) {}
      } finally {
        miningActionLocked = false;
        actionBtn.disabled = !AppState.auth.token || AppState.mining.state === 'MINING';
      }
    });

    renderMiningStateFn = renderMiningState;
    renderMiningState(AppState.mining.state);
  }

  // =========================================================================
  // 7. TAB 2: 30-LEVEL GRID WITH DRILL GRAPHICS & ACCURATE ADS STATE
  // =========================================================================
  function initUpgradeTab() {
    const gridContainer = document.getElementById('levels-grid-container');
    const modalBackdrop = document.getElementById('level-modal-backdrop');
    const modalTitle = document.getElementById('modal-level-title');
    const modalBody = document.getElementById('modal-level-body');
    const btnCloseModal = document.getElementById('btn-close-level-modal');
    const btnWatchAd = document.getElementById('btn-watch-ad');
    let levelModalTrigger = null;

    if (!gridContainer) return;

    function renderLevelsGrid() {
      gridContainer.innerHTML = '';
      LEVELS_DATA.forEach(item => {
        const card = document.createElement('button');
        card.type = 'button';
        card.setAttribute('aria-haspopup', 'dialog');
        const minerTier = MINER_TIER_STYLES[Math.min(5, Math.floor((item.level - 1) / 5))];
        const minerDesign = MINER_LEVEL_DESIGNS[item.level - 1];
        card.setAttribute('aria-label', `Level ${item.level}, ${minerTier.name}: ${formatNumber(item.speed)} Xu mỗi giờ, ${formatNumber(item.yield4h)} Xu mỗi phiên 4 giờ`);
        card.dataset.level = String(item.level);
        card.dataset.minerDesign = `${minerDesign.pose}-${minerDesign.helmet}-${minerDesign.tool}-${minerDesign.pack}`;
        let statusClass = 'locked';
        let badgeHtml = '<span class="level-lock-badge">🔒</span>';

        if (AppState.auth.token && item.level < AppState.user.currentLevel) {
          statusClass = 'completed';
          badgeHtml = '<span class="level-check-badge">✓</span>';
        } else if (AppState.auth.token && item.level === AppState.user.currentLevel) {
          statusClass = 'active';
          badgeHtml = '<span class="level-active-pill">ACTIVE</span>';
        }

        card.className = `level-card ${statusClass}`;
        card.innerHTML = `
          ${badgeHtml}
          <div class="level-card-top">
            <span class="level-title-text">LEVEL ${item.level}</span>
          </div>
          <div class="level-character-box">
            ${renderMinerCharacter(item)}
          </div>
          <div class="level-card-specs">
            <span class="spec-line rate">⚡ ${formatNumber(item.speed)} Xu/giờ</span>
            <span class="spec-line">🪙 ${formatNumber(item.yield4h)} Xu / 4 giờ</span>
          </div>
        `;

        card.addEventListener('click', () => {
          triggerHaptic('light');
          gridContainer.querySelectorAll('.level-card.is-selected').forEach((selected) => selected.classList.remove('is-selected'));
          card.classList.add('is-selected');
          levelModalTrigger = card;
          openLevelModal(item);
        });

        gridContainer.appendChild(card);
      });
    }

    renderLevelsGridFn = renderLevelsGrid;
    renderLevelsGrid();

    function openLevelModal(item) {
      modalTitle.textContent = `Thợ mỏ Level ${item.level}`;
      
      let statusText = 'Chưa đạt';
      let statusClass = 'locked';
      if (!AppState.auth.token) {
        statusText = 'Đăng nhập để xem Level hiện tại';
      } else if (item.level < AppState.user.currentLevel) {
        statusText = 'Đã mở khóa';
        statusClass = 'completed';
      } else if (item.level === AppState.user.currentLevel) {
        statusText = 'Đang sử dụng (Active)';
        statusClass = 'active';
      } else if (item.level === AppState.user.currentLevel + 1) {
        const remaining = Math.max(0, AppState.user.xpRequired - AppState.user.xpBalance);
        statusText = `Sắp mở khóa (Cần thêm ${remaining} XP)`;
        statusClass = 'next';
      } else {
        statusText = `Cần đạt Level ${item.level - 1} trước`;
      }

      modalBody.innerHTML = `
        <div class="level-detail-list">
          <div class="level-detail-row">
            <span>Trạng thái tài khoản</span>
            <strong>${AppState.auth.token ? statusText : 'Đăng nhập để xem Level hiện tại'}</strong>
          </div>
          <div class="level-detail-row">
            <span>Tốc độ đào</span>
            <strong class="level-detail-speed">${formatNumber(item.speed)} Xu/giờ</strong>
          </div>
          <div class="level-detail-row">
            <span>Sản lượng / phiên 4 giờ</span>
            <strong class="level-detail-yield">${formatNumber(item.yield4h)} Xu</strong>
          </div>
          <div class="level-detail-row">
            <span>XP cần để lên cấp tiếp</span>
            <strong>${item.xpReq > 0 ? `${item.xpReq} XP` : 'Cấp tối đa'}</strong>
          </div>
          <div class="level-detail-row">
            <span>Trạng thái</span>
            <strong class="level-detail-status ${statusClass}">${statusText}</strong>
          </div>
          <div class="level-detail-note">
            Cấp độ tăng bằng XP hợp lệ. Quảng cáo chỉ cộng XP sau khi nhận được xác minh thưởng từ nhà cung cấp.
          </div>
        </div>
      `;

      modalBackdrop.style.display = 'flex';
      modalBackdrop.setAttribute('aria-hidden', 'false');
      btnCloseModal.focus();
    }

    function closeLevelModal() {
      modalBackdrop.style.display = 'none';
      modalBackdrop.setAttribute('aria-hidden', 'true');
      levelModalTrigger?.focus();
    }

    btnCloseModal.addEventListener('click', closeLevelModal);

    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) closeLevelModal();
    });

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modalBackdrop.style.display === 'flex') closeLevelModal();
    });

    // Fix 3: Rewarded Ads - Honest, professional messaging (AdsGram not connected in Phase 1)
    btnWatchAd.addEventListener('click', () => {
      triggerHaptic('info');
      showToast('AdsGram chưa được kết nối. Chưa có XP nào được cộng.', 'info', 3500);
    });
  }

  // =========================================================================
  // 8. TAB 3: CHECK-IN & COMMUNITY TASKS (NO FAKE CALLBACKS)
  // =========================================================================
  function initCheckinTab() {
    const btnClaim = document.getElementById('btn-claim-checkin');
    const btnJoinGroup = document.getElementById('btn-join-group');
    const btnVerifyGroup = document.getElementById('btn-verify-group');
    const btnJoinChannel = document.getElementById('btn-join-channel');
    const btnVerifyChannel = document.getElementById('btn-verify-channel');

    btnClaim.addEventListener('click', async () => {
      if (!AppState.auth.token || AppState.checkin.todayClaimed) return;
      btnClaim.disabled = true;
      try {
        const result = await apiRequest('/api/checkin/claim', {
          method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() }
        });
        applyCheckinResponse(result.status);
        await refreshBackendData();
        triggerHaptic('success');
        showToast(`Đã nhận ${formatNumber(result.reward_xu)} Xu điểm danh.`, 'success');
      } catch (error) {
        showToast(error.message || 'Không thể điểm danh lúc này.', 'error');
        try { await refreshBackendData(); } catch (_) {}
      }
    });

    btnJoinGroup.addEventListener('click', () => openCommunityTask('group'));
    btnJoinChannel.addEventListener('click', () => openCommunityTask('channel'));
    btnVerifyGroup.addEventListener('click', () => verifyCommunityTask('group'));
    btnVerifyChannel.addEventListener('click', () => verifyCommunityTask('channel'));
    renderCommunityTasks();
  }

  function communityTask(type) {
    return AppState.communityTasks.find(task => task.task_type === type && task.active);
  }

  function renderCommunityTasks() {
    [['group', 'btn-join-group', 'btn-verify-group'], ['channel', 'btn-join-channel', 'btn-verify-channel']]
      .forEach(([type, joinId, verifyId]) => {
        const task = communityTask(type);
        const join = document.getElementById(joinId);
        const verify = document.getElementById(verifyId);
        const card = document.getElementById(`task-${type}`);
        if (!join || !verify) return;
        join.disabled = !AppState.auth.token || !task?.telegram_link;
        verify.disabled = !AppState.auth.token || !task || task.verified || AppState.auth.state !== 'AUTHENTICATED';
        const joinText = join.querySelector('span');
        if (joinText) joinText.textContent = task?.telegram_link ? 'Tham gia' : 'Chưa cấu hình';
        const verifyText = verify.querySelector('span');
        if (verifyText) verifyText.textContent = task?.verified ? '✓ Đã nhận thưởng' : '✓ Xác minh';
        card?.classList.toggle('is-verified', Boolean(task?.verified));
      });
  }

  function openCommunityTask(type) {
    const task = communityTask(type);
    if (!task?.telegram_link) return;
    if (tg?.openTelegramLink) tg.openTelegramLink(task.telegram_link);
    else window.open(task.telegram_link, '_blank', 'noopener,noreferrer');
  }

  async function verifyCommunityTask(type) {
    const task = communityTask(type);
    if (!task || !AppState.auth.token) return;
    try {
      const result = await apiRequest('/api/community/verify', { method: 'POST', body: { task_id: task.id } });
      if (!result.verified) {
        showToast('Chưa xác minh được thành viên. Hãy tham gia rồi thử lại.', 'info');
        return;
      }
      await refreshBackendData();
      showToast(result.already_rewarded ? 'Nhiệm vụ này đã được nhận trước đó.' : `Đã nhận ${formatNumber(result.reward_xu)} Xu.`, 'success');
    } catch (error) {
      showToast(error.message || 'Chưa thể xác minh nhiệm vụ.', 'error');
    }
  }

  // =========================================================================
  // 9. TAB 4: REFERRAL & F1 LIST
  // =========================================================================
  function initReferralTab() {
    const btnQuickCopy = document.getElementById('btn-quick-copy');
    const btnCopyRef = document.getElementById('btn-copy-ref');
    const btnShareRef = document.getElementById('btn-share-ref');
    const refLinkInput = document.getElementById('ref-link-input');
    const f1Container = document.getElementById('f1-user-list-container');

    renderReferralListFn = () => {
      if (refLinkInput) refLinkInput.value = AppState.referral.refLink || '';
      const total = document.getElementById('ref-total-f1');
      const qualified = document.getElementById('ref-qualified-f1');
      const commission = document.getElementById('ref-commission-val');
      const heading = document.getElementById('ref-f1-heading');
      if (total) total.textContent = AppState.auth.token ? formatNumber(AppState.referral.totalF1) : '—';
      if (qualified) qualified.textContent = AppState.auth.token ? formatNumber(AppState.referral.qualifiedF1) : '—';
      if (commission) commission.textContent = AppState.auth.token ? formatNumber(AppState.referral.commissionXu) : '—';
      if (heading) heading.textContent = `Danh sách F1${AppState.auth.token ? ` (${AppState.referral.totalF1})` : ''}`;
      [btnQuickCopy, btnCopyRef, btnShareRef].filter(Boolean).forEach(button => {
        button.disabled = !AppState.auth.token || !AppState.referral.refLink;
      });
      if (!f1Container) return;
      f1Container.replaceChildren();
      if (!AppState.referral.f1List.length) {
        const empty = document.createElement('p');
        empty.className = 'f1-empty-state';
        empty.textContent = AppState.auth.token ? 'Chưa có lượt giới thiệu.' : 'Đăng nhập để xem dữ liệu giới thiệu.';
        f1Container.appendChild(empty);
        return;
      }
      AppState.referral.f1List.forEach(member => {
        const row = document.createElement('div');
        row.className = 'f1-user-row';
        const details = document.createElement('div');
        details.className = 'f1-user-info';
        const avatar = document.createElement('div');
        avatar.className = 'f1-avatar-circle';
        avatar.textContent = '•';
        const info = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'f1-username';
        name.textContent = member.username || 'Người chơi';
        const level = document.createElement('div');
        level.className = 'f1-level';
        level.textContent = `Level ${member.level}`;
        info.append(name, level);
        details.append(avatar, info);
        const badge = document.createElement('span');
        badge.className = `f1-status-badge ${member.qualified ? 'qualified' : 'pending'}`;
        badge.textContent = member.qualified ? 'Đã đạt ✓' : 'Chưa đạt ⏳';
        row.append(details, badge);
        f1Container.appendChild(row);
      });
    };

    let copyInProgress = false;
    async function copyLink() {
      if (copyInProgress) return;
      const value = refLinkInput?.value?.trim();
      if (!value) {
        showToast('Chưa có link giới thiệu để sao chép.', 'error');
        return;
      }

      copyInProgress = true;
      [btnQuickCopy, btnCopyRef].filter(Boolean).forEach((button) => { button.disabled = true; });
      try {
        let copied = false;
        if (navigator.clipboard?.writeText) {
          try {
            await navigator.clipboard.writeText(value);
            copied = true;
          } catch (error) {
            copied = false;
          }
        }

        if (!copied) {
          refLinkInput.focus();
          refLinkInput.select();
          refLinkInput.setSelectionRange(0, value.length);
          copied = document.execCommand('copy');
          refLinkInput.setSelectionRange(0, 0);
          refLinkInput.blur();
        }

        if (!copied) throw new Error('Clipboard copy failed');
        triggerHaptic('success');
        showToast('Đã sao chép link giới thiệu.', 'success');
      } catch (error) {
        triggerHaptic('error');
        showToast('Không thể sao chép. Hãy chọn và sao chép link theo cách thủ công.', 'error');
      } finally {
        copyInProgress = false;
        [btnQuickCopy, btnCopyRef].filter(Boolean).forEach((button) => { button.disabled = !AppState.auth.token || !AppState.referral.refLink; });
      }
    }

    if (btnQuickCopy) btnQuickCopy.addEventListener('click', copyLink);
    if (btnCopyRef) btnCopyRef.addEventListener('click', copyLink);

    if (btnShareRef) {
      btnShareRef.addEventListener('click', () => {
        triggerHaptic('light');
        const shareText = encodeURIComponent('Tham gia MineRewards Mini App cùng mình: ');
        const shareUrl = encodeURIComponent(refLinkInput?.value || '');
        const tgShareLink = `https://t.me/share/url?url=${shareUrl}&text=${shareText}`;

        if (!shareUrl) {
          showToast('Chưa có link giới thiệu để chia sẻ.', 'error');
          return;
        }

        if (tg?.openTelegramLink) {
          tg.openTelegramLink(tgShareLink);
          showToast('Đã mở Telegram để chia sẻ link giới thiệu.', 'info');
        } else if (window.open(tgShareLink, '_blank', 'noopener,noreferrer')) {
          showToast('Đã mở cửa sổ chia sẻ Telegram.', 'info');
        } else {
          showToast('Không thể mở Telegram để chia sẻ. Hãy sao chép link thủ công.', 'error');
        }
      });
    }

    renderReferralListFn();
  }

  // =========================================================================
  // 10. TAB 5: WALLET, WITHDRAWAL FORM & STRICT VALIDATION
  // =========================================================================
  function initWalletTab() {
    const subnavTabs = document.querySelectorAll('.subnav-tab');
    const subtabContents = {
      'withdraw-form': document.getElementById('subtab-withdraw-form'),
      'withdraw-history': document.getElementById('subtab-withdraw-history')
    };

    subnavTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        triggerHaptic('light');
        const targetSub = tab.getAttribute('data-subtab');
        if (!subtabContents[targetSub]) return;

        subnavTabs.forEach((t) => {
          const isActive = t === tab;
          t.classList.toggle('active', isActive);
          t.setAttribute('aria-pressed', String(isActive));
        });
        tab.classList.add('active');

        Object.keys(subtabContents).forEach(key => {
          if (subtabContents[key]) {
            subtabContents[key].hidden = key !== targetSub;
            subtabContents[key].classList.toggle('active', key === targetSub);
          }
        });
      });
    });

    // Payment Method Switching (MoMo, Ngân Hàng, ZaloPay)
    const methodPills = document.querySelectorAll('.payment-method-pill');
    const labelAccountNum = document.getElementById('label-account-num');
    const inputAccountNum = document.getElementById('withdraw-account-num');
    const bankSelectGroup = document.getElementById('bank-select-group');

    methodPills.forEach(pill => {
      pill.addEventListener('click', () => {
        triggerHaptic('light');
        methodPills.forEach((methodPill) => {
          const isActive = methodPill === pill;
          methodPill.classList.toggle('active', isActive);
          methodPill.setAttribute('aria-pressed', String(isActive));
        });

        const method = pill.getAttribute('data-method');
        AppState.wallet.currentMethod = method;

        if (method === 'momo') {
          labelAccountNum.textContent = 'Số tài khoản ví MoMo';
          inputAccountNum.placeholder = 'Nhập số điện thoại (VD: 0912345678)';
          if (bankSelectGroup) bankSelectGroup.hidden = true;
        } else if (method === 'bank') {
          labelAccountNum.textContent = 'Số tài khoản ngân hàng';
          inputAccountNum.placeholder = 'Nhập số tài khoản ngân hàng';
          if (bankSelectGroup) bankSelectGroup.hidden = false;
        } else if (method === 'zalopay') {
          labelAccountNum.textContent = 'Số tài khoản ví ZaloPay';
          inputAccountNum.placeholder = 'Nhập số điện thoại (VD: 0987654321)';
          if (bankSelectGroup) bankSelectGroup.hidden = true;
        }
      });
    });

    // Preset Amount Chips & Calculation (2 Xu = 1 VND)
    const presetChips = document.querySelectorAll('.preset-chip');
    const inputAmountVnd = document.getElementById('withdraw-amount-vnd');
    const helperXuRequired = document.getElementById('helper-xu-required');

    function updateXuRequired() {
      const vnd = parseInt(inputAmountVnd.value, 10) || 0;
      const xu = vnd * 2;
      helperXuRequired.textContent = `${formatNumber(xu)} Xu`;

      presetChips.forEach(chip => {
        if (parseInt(chip.getAttribute('data-amount'), 10) === vnd) {
          chip.classList.add('active');
        } else {
          chip.classList.remove('active');
        }
      });
    }

    presetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        triggerHaptic('light');
        inputAmountVnd.value = chip.getAttribute('data-amount');
        updateXuRequired();
      });
    });

    inputAmountVnd.addEventListener('input', updateXuRequired);

    const btnSubmit = document.getElementById('btn-submit-withdraw');
    btnSubmit.addEventListener('click', async () => {
      if (!AppState.auth.token) return;
      try {
        await apiRequest('/api/wallet/withdraw', {
          method: 'POST', headers: { 'Idempotency-Key': newIdempotencyKey() },
          body: { amount_vnd: Number(document.getElementById('withdraw-amount-vnd').value), payment_method: AppState.wallet.currentMethod }
        });
      } catch (error) {
        showToast(error.message || 'Đổi/rút tiền đang tắt.', 'info');
      }
    });

    function renderWithdrawalHistory() {
      const container = document.getElementById('withdraw-history-list');
      if (!container) return;

      container.replaceChildren();
      const count = document.getElementById('withdraw-count-label');
      if (count) count.textContent = `${AppState.wallet.withdrawalHistory.length} bản ghi`;
      if (!AppState.wallet.withdrawalHistory.length) {
        const empty = document.createElement('p');
        empty.className = 'withdrawal-empty-state';
        empty.textContent = 'Chưa có lịch sử rút tiền.';
        container.appendChild(empty);
      }
      AppState.wallet.withdrawalHistory.forEach(item => {
        const row = document.createElement('div');
        row.className = 'history-item-row';
        const summary = document.createElement('div');
        summary.className = 'history-left';
        const amount = document.createElement('span');
        amount.className = 'history-amount';
        amount.textContent = `${formatNumber(item.amount_vnd)} VND (${formatNumber(item.xu_locked)} Xu)`;
        const date = document.createElement('span');
        date.className = 'history-date';
        date.textContent = item.created_at || '';
        summary.append(amount, date);
        const status = document.createElement('span');
        status.className = 'history-badge pending';
        status.textContent = item.withdrawal_status || 'Chờ xử lý';
        row.append(summary, status);
        container.appendChild(row);
      });
    }

    renderWithdrawalHistoryFn = renderWithdrawalHistory;
    renderWithdrawalHistory();
  }

  // =========================================================================
  // 11. CENTRALIZED UI DATA SYNCHRONIZATION
  // =========================================================================
  function updateAllUI() {
    const topCoinText = document.getElementById('top-coin-text');
    const topLevelBadge = document.getElementById('top-level-badge');
    const topXpBar = document.getElementById('top-xp-bar');
    const topXpText = document.getElementById('top-xp-text');
    const topNextLevelLabel = document.getElementById('top-next-level-label');

    const walletAvailXu = document.getElementById('wallet-available-xu');
    const walletConvertedVnd = document.getElementById('wallet-converted-vnd');

    const summaryLevelVal = document.getElementById('summary-level-val');
    const summaryYieldVal = document.getElementById('summary-yield-val');
    const miningSpeedDisplay = document.getElementById('mining-speed-display');
    const sessionYieldAmount = document.getElementById('session-yield-amount');

    const dockLevelNum = document.getElementById('dock-level-num');
    const dockSpeedText = document.getElementById('dock-speed-text');
    const dockSessionText = document.getElementById('dock-session-text');
    const dockXpHeaderTitle = document.querySelector('.dock-xp-header .xp-title');
    const dockXpText = document.getElementById('dock-xp-text');
    const dockXpFill = document.getElementById('dock-xp-fill');
    const dockXpPercent = document.getElementById('dock-xp-percent');
    const dockXpProgress = document.querySelector('.level-xp-card .dock-xp-bar');

    // Current level configuration lookup (Adhering strictly to Table 8.2)
    const currentConfig = LEVELS_DATA.find(l => l.level === AppState.user.currentLevel);
    const requiredXp = currentConfig ? currentConfig.xpReq : 0;
    AppState.user.xpRequired = requiredXp;

    const authenticated = Boolean(AppState.auth.token);
    let pct = authenticated ? 100 : 0;
    let xpTextVal = authenticated ? `MAX · ${formatNumber(AppState.user.xpLifetime)} XP` : 'Chưa đăng nhập';
    if (authenticated && AppState.user.currentLevel < 30 && requiredXp > 0) {
      pct = Math.min(100, Math.max(0, Math.round((AppState.user.xpBalance / requiredXp) * 100)));
      xpTextVal = `XP: ${AppState.user.xpBalance}/${requiredXp}`;
    }

    const availFormatted = authenticated ? `${formatNumber(AppState.user.availableXu)} Xu` : '— Xu';

    if (topCoinText) topCoinText.textContent = availFormatted;
    if (topLevelBadge) topLevelBadge.textContent = authenticated ? `LEVEL ${AppState.user.currentLevel}` : 'LEVEL —';
    if (topXpBar) topXpBar.style.width = `${pct}%`;
    if (topXpText) topXpText.textContent = xpTextVal;
    if (topNextLevelLabel) {
      topNextLevelLabel.textContent = !authenticated ? '—' : AppState.user.currentLevel < 30 ? `Lv ${AppState.user.currentLevel + 1}` : 'MAX';
    }

    if (walletAvailXu) walletAvailXu.textContent = availFormatted;
    if (walletConvertedVnd) walletConvertedVnd.textContent = 'Chưa bật';

    if (summaryLevelVal) summaryLevelVal.textContent = authenticated ? AppState.user.currentLevel : '—';
    if (summaryYieldVal) summaryYieldVal.textContent = authenticated ? `${formatNumber(AppState.mining.sessionYieldXu)} Xu` : '— Xu';
    if (miningSpeedDisplay) miningSpeedDisplay.textContent = authenticated ? `${formatNumber(AppState.mining.speedPerHour)} Xu/giờ` : '— Xu/giờ';
    if (sessionYieldAmount) sessionYieldAmount.textContent = authenticated ? `${formatNumber(AppState.mining.sessionYieldXu)} Xu` : '— Xu';

    if (dockLevelNum) dockLevelNum.textContent = authenticated ? AppState.user.currentLevel : '—';
    if (dockSpeedText) dockSpeedText.textContent = authenticated ? `${formatNumber(AppState.mining.speedPerHour)} Xu/giờ` : '— Xu/giờ';
    if (dockSessionText) dockSessionText.textContent = authenticated ? `${formatNumber(AppState.mining.sessionYieldXu)} Xu / phiên 4 giờ` : '— Xu / phiên 4 giờ';
    if (dockXpProgress) dockXpProgress.setAttribute('aria-valuenow', String(pct));

    if (!authenticated) {
      if (dockXpHeaderTitle) dockXpHeaderTitle.textContent = 'Tiến trình XP';
      if (dockXpText) dockXpText.textContent = 'Chưa đăng nhập';
      if (dockXpFill) dockXpFill.style.width = '0%';
      if (dockXpPercent) dockXpPercent.textContent = '—';
    } else if (AppState.user.currentLevel < 30) {
      if (dockXpHeaderTitle) dockXpHeaderTitle.textContent = `XP lên Level ${AppState.user.currentLevel + 1}:`;
      if (dockXpText) dockXpText.textContent = `${AppState.user.xpBalance} / ${requiredXp}`;
      if (dockXpFill) dockXpFill.style.width = `${pct}%`;
      if (dockXpPercent) dockXpPercent.textContent = `${pct}%`;
    } else {
      if (dockXpHeaderTitle) dockXpHeaderTitle.textContent = 'Cấp độ tối đa:';
      if (dockXpText) dockXpText.textContent = `Tích lũy ${formatNumber(AppState.user.xpLifetime)} XP`;
      if (dockXpFill) dockXpFill.style.width = '100%';
      if (dockXpPercent) dockXpPercent.textContent = 'MAX';
    }
  }

  // =========================================================================
  // 12. INITIALIZATION ON DOM READY
  // =========================================================================
  document.addEventListener('DOMContentLoaded', () => {
    initThemeToggle();
    initTelegramMiniApp();
    initTabNavigation();
    initMiningTab();
    initUpgradeTab();
    initCheckinTab();
    initReferralTab();
    initWalletTab();
    updateAllUI();

    // Expose internal state adapter for Telegram Mini App harness & testing
    window.AppState = AppState;
    window.addXp = addXp;
    window.updateAllUI = updateAllUI;

    connectBackend();
    console.log('MineRewards Telegram Mini App connected to the server adapter.');
  });

})();
