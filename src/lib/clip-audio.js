// Audio graph duration stops each requested prefix exactly, without UI timers.
export class ClipAudio {
  constructor(
    url,
    onState = () => {},
    contextFactory = () =>
      new (window.AudioContext || window.webkitAudioContext)(),
    decoderFactory = () => {
      const OfflineContext =
        window.OfflineAudioContext || window.webkitOfflineAudioContext;
      return OfflineContext ? new OfflineContext(2, 1, 44100) : null;
    },
  ) {
    this.url = url;
    this.onState = onState;
    this.contextFactory = contextFactory;
    this.decoderFactory = decoderFactory;
    this.token = 0;
    this.controller = new AbortController();
    this.source = null;
    this.context = null;
    this.buffer = null;
    this.bytes = null;
    this.readyPromise = null;
    this.decodePromise = null;
    this.disposed = false;
  }
  get playing() {
    return !!this.source && this.context?.state === "running";
  }
  get position() {
    if (!this.source) return this.lastPosition || 0;
    const elapsed = Math.max(0, this.context.currentTime - this.startedAt);
    return Math.min(elapsed, this.limit);
  }
  pause() {
    this.token++;
    this.lastPosition = 0;
    if (this.source) {
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    this.onState(false);
  }
  preload() {
    if (this.disposed) return Promise.resolve(null);
    if (this.readyPromise) return this.readyPromise;
    const pending = (async () => {
      const response = await fetch(this.url, {
        signal: this.controller.signal,
        credentials: "omit",
      });
      if (!response.ok) throw new Error("Preview unavailable");
      const bytes = await response.arrayBuffer();
      if (this.disposed) return null;
      this.bytes = bytes;
      // Offline decoding prepares audio without opening an output device.
      // The live AudioContext is created only by an explicit play gesture.
      const decoder = this.decoderFactory();
      if (decoder) await this.decode(decoder);
      if (this.disposed) return null;
      return { duration: this.buffer?.duration || 0 };
    })();
    this.readyPromise = pending;
    pending.catch(() => {
      if (this.readyPromise === pending) this.readyPromise = null;
      this.bytes = null;
    });
    return pending;
  }
  decode(context) {
    if (this.buffer) return Promise.resolve(this.buffer);
    if (this.decodePromise) return this.decodePromise;
    const pending = context
      .decodeAudioData(this.bytes.slice(0))
      .then((buffer) => {
        if (this.disposed) return null;
        if (!(buffer.duration > 0)) throw new Error("Empty preview");
        this.buffer = buffer;
        this.bytes = null;
        return buffer;
      });
    this.decodePromise = pending;
    pending
      .finally(() => {
        if (this.decodePromise === pending) this.decodePromise = null;
      })
      .catch(() => {});
    return pending;
  }
  async play(seconds) {
    if (this.disposed) return null;
    this.pause();
    const token = this.token;
    this.context ||= this.contextFactory();
    this.context.onstatechange = () => {
      if (this.context.state !== "running" && this.source) this.pause();
    };
    await this.context.resume();
    if (this.disposed || token !== this.token) return null;
    await this.preload();
    if (this.disposed || token !== this.token) return null;
    if (!this.buffer) await this.decode(this.context);
    if (this.disposed || token !== this.token) return null;
    this.limit = Math.min(Math.max(seconds, 0.001), this.buffer.duration);
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.loop = false;
    source.connect(this.context.destination);
    source.onended = () => {
      if (this.source === source) {
        source.disconnect();
        this.source = null;
        this.lastPosition = this.limit;
        this.onState(false);
      }
    };
    this.source = source;
    this.startedAt = this.context.currentTime;
    source.start(0, 0, this.limit);
    this.onState(true);
    return { duration: this.buffer.duration, limit: this.limit };
  }
  dispose() {
    this.disposed = true;
    this.pause();
    this.controller.abort();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
    }
    this.buffer = null;
    this.bytes = null;
  }
}
