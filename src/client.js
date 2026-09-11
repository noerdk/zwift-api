import { ZwiftAuthError } from './errors.js';
import { DEFAULT_API_BASE, DEFAULT_AUTH_BASE } from './http.js';
import { memoryTokenStore, passwordGrant, refreshGrant } from './auth.js';
import * as R from './resources.js';

/**
 * Read-only client for Zwift's undocumented API.
 *
 * Deliberately has no write methods. Zwift exposes achievement-unlock endpoints
 * (`/api/achievement/unlock`, `/api/achievement/route-completion-achievement-unlocks`)
 * which AWARD achievements; calling them would falsify the very data this
 * library exists to read, so they are not implemented.
 */
export class ZwiftClient {
  #session = null;
  #inflight = null;

  constructor({
    apiBase = DEFAULT_API_BASE,
    authBase = DEFAULT_AUTH_BASE,
    tokenStore = memoryTokenStore(),
    fetchImpl = fetch,
    timeoutMs = 30_000,
    credentials = null,           // { username, password } — used only to re-auth
  } = {}) {
    this.apiBase = apiBase;
    this.authBase = authBase;
    this.tokenStore = tokenStore;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.credentials = credentials;
  }

  /** Bound context handed to each resource function. */
  #ctx() {
    return {
      apiBase: this.apiBase,
      opts: () => ({
        headers: { Authorization: `Bearer ${this.#session.accessToken}` },
        fetchImpl: this.fetchImpl,
        timeoutMs: this.timeoutMs,
      }),
    };
  }

  get session() { return this.#session; }
  get signedIn() { return this.#session != null; }

  /** Exchange a password for tokens. The password is never stored. */
  async login({ username, password } = {}) {
    const s = await passwordGrant({
      username: username ?? this.credentials?.username,
      password: password ?? this.credentials?.password,
      authBase: this.authBase, fetchImpl: this.fetchImpl,
    });
    this.#adopt(s);
    return this.describeSession();
  }

  /**
   * Sign in using the stored refresh token, falling back to a password grant
   * when that fails and credentials are available. Safe to call repeatedly:
   * concurrent calls share one in-flight request.
   */
  async connect() {
    if (this.#session) return this.describeSession();
    if (this.#inflight) return this.#inflight;
    this.#inflight = (async () => {
      const stored = await this.tokenStore.get();
      if (stored) {
        try {
          this.#adopt(await refreshGrant(stored, { authBase: this.authBase, fetchImpl: this.fetchImpl }));
          return this.describeSession('refresh');
        } catch (err) {
          if (!this.credentials) throw err;
        }
      }
      if (!this.credentials) {
        throw new ZwiftAuthError('no stored refresh token and no credentials supplied');
      }
      await this.login();
      return this.describeSession('password');
    })().finally(() => { this.#inflight = null; });
    return this.#inflight;
  }

  #adopt(s) {
    this.#session = s;
    if (s.refreshToken) this.tokenStore.set(s.refreshToken);
  }

  /** Session facts with no token material in them. */
  describeSession(via) {
    const s = this.#session;
    if (!s) return null;
    return { via, expiresAt: s.expiresAt, expiresIn: s.expiresIn, tokenType: s.tokenType, scope: s.scope };
  }

  async logout() { this.#session = null; await this.tokenStore.clear(); }

  async #ready() { if (!this.#session) await this.connect(); return this.#ctx(); }

  // --- resources -----------------------------------------------------------
  async profile() { return R.profile(await this.#ready()); }
  async earnedAchievementIds() { return R.earnedAchievementIds(await this.#ready()); }
  async routeCompletionAchievements() { return R.routeCompletionAchievements(await this.#ready()); }
  async achievementCatalogue() { return R.achievementCatalogue(await this.#ready()); }
  async challenges() { return R.challenges(await this.#ready()); }
  async gameInfo() { return R.gameInfo(await this.#ready()); }
  async upcomingEvents() { return R.upcomingEvents(await this.#ready()); }
  async quests(opts) { return R.quests(await this.#ready(), opts); }
  async quest(id) { return R.quest(await this.#ready(), id); }
  async activities(opts) { return R.activities(await this.#ready(), opts); }

  // Verified-but-not-fully-mapped surfaces, kept so the client is a complete
  // model of what the API exposes. See each resource's JSDoc.
  async fitnessMetricsAndGoals() { return R.fitnessMetricsAndGoals(await this.#ready()); }
  async streaks() { return R.streaks(await this.#ready()); }
  async personalRecords() { return R.personalRecords(await this.#ready()); }
  async zfiles() { return R.zfiles(await this.#ready()); }
  async powerCurve(opts) { return R.powerCurve(await this.#ready(), opts); }
  async racingScore() { return R.racingScore(await this.#ready()); }
  async clubs() { return R.clubs(await this.#ready()); }
  async homeRecommendations() { return R.homeRecommendations(await this.#ready()); }
}
