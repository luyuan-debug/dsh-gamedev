/** One native-MCP lease. No transport or model-call dispatch implementation. */
export type NativeMount = { ready: Promise<unknown>; dispose(): Promise<unknown> | unknown };
export type Lease<A, S> = {
  agent: A; settings: S; revision: number; mount?: NativeMount; stopped?: Promise<void>; revoked: Promise<void>; revoke(): void; ready: boolean;
};
export type LeaseHooks<A, S> = {
  eligible(agent: A): boolean;
  enabled(): boolean;
  settings(): S;
  compatible(agent: A, settings: S): boolean;
  sameSettings?(left: S, right: S): boolean;
  start(lease: Lease<A, S>): NativeMount;
  priorStop?: Promise<void>;
  state(phase: string, detail: string, lease?: Lease<A, S>): void;
};
export class NativeLease<A extends object, S> {
  lease?: Lease<A, S>;
  preferred?: A;
  private revision = 0;
  private closed = false;
  private queue: Promise<void> = Promise.resolve();
  private scheduled = false;
  private dirty = false;
  private retirePromise?: Promise<void>;
  constructor(private hooks: LeaseHooks<A, S>) {}
  request(agent: A) {
    if (this.closed || !this.hooks.eligible(agent)) return Promise.resolve();
    const current = this.preferred;
    if (current && current !== agent && this.lease && !this.lease.stopped && this.hooks.eligible(current) && this.hooks.compatible(current, this.hooks.settings())) return Promise.resolve();
    this.preferred = agent;
    return this.schedule();
  }
  released(agent: A) {
    if (this.preferred === agent) this.preferred = undefined;
    if (this.lease?.agent === agent) return this.revoke('The owning session closed.');
    return Promise.resolve();
  }
  /** Revocation is synchronous. Cleanup returns one shared, awaitable promise. */
  revoke(reason: string) {
    ++this.revision;
    const lease = this.lease;
    if (lease) { this.hooks.state('STOPPING', reason, lease); void this.stop(lease); }
    return this.schedule();
  }
  changed() {
    const lease = this.lease;
    if (!this.hooks.enabled() || (lease && !this.hooks.compatible(lease.agent, this.hooks.settings()))) return this.revoke('Saved settings revoked this connection; an in-flight write may already have applied.');
    return this.schedule();
  }
  shutdown() {
    if (this.retirePromise) return this.retirePromise;
    this.closed = true; this.preferred = undefined;
    this.retirePromise = this.revoke('This plugin definition was unloaded.').then(() => undefined);
    return this.retirePromise;
  }
  owns(agent: A) {
    const lease = this.lease;
    return !!lease && lease.ready && !lease.stopped && lease.revision === this.revision && lease.agent === agent && !this.closed && this.hooks.enabled() && this.hooks.eligible(agent) && this.hooks.compatible(agent, this.hooks.settings());
  }
  settled() { return this.queue; }
  private stop(lease: Lease<A, S>) {
    lease.revoke();
    return lease.stopped ??= (async () => {
      await Promise.resolve();
      if (lease.mount) await lease.mount.dispose();
      lease.ready = false;
    })();
  }
  private schedule() {
    this.dirty = true;
    if (this.scheduled) return this.queue;
    this.scheduled = true;
    this.queue = this.queue.catch(() => {}).then(async () => {
      try {
        do { this.dirty = false; await this.drive(); } while (this.dirty);
      } finally { this.scheduled = false; }
    });
    return this.queue;
  }
  private async drive() {
    const old = this.lease;
    if (old && (old.stopped || old.revision !== this.revision || this.closed || !this.hooks.enabled() || !this.hooks.eligible(old.agent) || !this.hooks.compatible(old.agent, this.hooks.settings()))) {
      await this.stop(old);
      if (this.lease === old) this.lease = undefined;
    }
    if (this.closed) { this.hooks.state('UNLOADED', 'This definition is retired; open a new Godot 2D session after enabling the plugin.'); return; }
    if (!this.hooks.enabled()) { this.hooks.state('DISABLED', 'Bridge disabled. Its owned native MCP process has been released.'); return; }
    if (this.lease?.ready) return;
    const agent = this.preferred;
    if (!agent || !this.hooks.eligible(agent)) { this.hooks.state('WAITING_FOR_SESSION', 'Select Godot 2D in a session bound to the configured project.'); return; }
    const settings = this.hooks.settings();
    if (!this.hooks.compatible(agent, settings)) { this.hooks.state('NEW_SESSION_REQUIRED', 'The saved target differs from this session binding. Open a new session for the configured project.'); return; }
    const revision = this.revision;
    await this.hooks.priorStop;
    const currentSettings = this.hooks.settings();
    const sameSettings = this.hooks.sameSettings?.(settings, currentSettings) ?? JSON.stringify(settings) === JSON.stringify(currentSettings);
    if (this.closed || !this.hooks.enabled() || revision !== this.revision || this.preferred !== agent || !this.hooks.eligible(agent) || !this.hooks.compatible(agent, currentSettings) || !sameSettings) { this.dirty = true; return; }
    const revoked = Promise.withResolvers<void>();
    const lease: Lease<A, S> = { agent, settings, revision, ready: false, revoked: revoked.promise, revoke: () => revoked.resolve() };
    this.lease = lease;
    this.hooks.state('STARTING', 'Starting the installed native MCP connection.', lease);
    try {
      lease.mount = this.hooks.start(lease);
      await Promise.race([lease.mount.ready, lease.revoked.then(() => { throw new Error('Bridge activation was revoked.'); })]);
      if (this.closed || !this.hooks.enabled() || revision !== this.revision || !this.hooks.eligible(agent) || !this.hooks.compatible(agent, this.hooks.settings())) {
        await this.stop(lease); if (this.lease === lease) this.lease = undefined; this.dirty = true; return;
      }
      lease.ready = true;
      this.hooks.state('MCP_READY', 'Native MCP ready. Editor connectivity is verified by a health call; no continuous online claim.', lease);
    } catch (error: any) {
      await this.stop(lease);
      if (this.lease === lease) this.lease = undefined;
      if (this.closed || !this.hooks.enabled() || revision !== this.revision) { this.dirty = true; return; }
      this.hooks.state('UNAVAILABLE', error?.message || 'Native MCP startup failed.');
    }
  }
}
