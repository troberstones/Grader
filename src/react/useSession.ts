"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Envelope } from "../core/actions";
import { ClockSync } from "../core/clock";
import type { Author, Peer, Role } from "../core/types";
import type { ReviewChannel } from "../adapter/types";

/**
 * Session, roles, presence and the shared clock.
 *
 * Master is about transport, not authorship: a follower drawing on the
 * projector is a first-class stroke author. Only who *drives* is exclusive.
 */

const PING_INTERVAL_MS = 25_000;
const PEER_TIMEOUT_MS = 70_000;
/** Pings fired back-to-back when first measuring a master's clock. */
const CLOCK_BURST = 5;
const CLOCK_BURST_SPACING_MS = 220;

export interface SessionApi {
  role: Role;
  isMaster: boolean;
  followView: boolean;
  setFollowView: (v: boolean) => void;
  peers: Peer[];
  masterName: string | null;
  connected: boolean;
  rttMs: number | null;
  clock: ClockSync;
  claim: () => void;
  release: () => void;
  /** Leave the master's transport and browse alone; rejoin() snaps back. */
  breakAway: () => void;
  rejoin: () => void;
  send: (action: Action) => void;
  subscribe: (handler: (e: Envelope) => void) => () => void;
}

export function useSession(channel: ReviewChannel, author: Author): SessionApi {
  // You drive your own screen until someone actually takes control. Defaulting
  // to `follower` locked a lone reviewer out of their own transport when there
  // was no master in the room to follow.
  const [role, setRole] = useState<Role>("free");
  const [followView, setFollowView] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [connected, setConnected] = useState(channel.connected);
  const [rttMs, setRttMs] = useState<number | null>(null);

  const clock = useMemo(() => new ClockSync(), []);
  const roleRef = useRef(role);
  roleRef.current = role;

  /**
   * "free" means two different things and they must not be confused: a device
   * that has simply not been told to follow anyone yet, and one that has
   * deliberately broken away. Only the latter should ignore a new master.
   */
  const brokeAwayRef = useRef(false);
  const pendingPings = useRef(new Map<string, number>());
  const peersRef = useRef(new Map<string, Peer>());

  const send = useCallback((action: Action) => channel.send(action), [channel]);
  const subscribe = channel.subscribe;

  /** Is anyone other than `excluding` still holding master? */
  const hasOtherMaster = useCallback((excluding: string) => {
    for (const [id, p] of peersRef.current) {
      if (id !== excluding && p.role === "master") return true;
    }
    return false;
  }, []);

  const pingOnce = useCallback(() => {
    const t = Date.now();
    pendingPings.current.set(String(t), t);
    // Bound the map if peers vanish mid-exchange.
    if (pendingPings.current.size > 32) {
      const oldest = [...pendingPings.current.keys()][0];
      pendingPings.current.delete(oldest);
    }
    send({ a: "ping", client: channel.clientId, t });
  }, [channel, send]);

  /**
   * Measure the clock against the master.
   *
   * The estimator keeps the lowest-RTT sample, so one ping is a poor estimate —
   * it might be the one that hit a WiFi retransmit. A short burst converges in
   * under a second instead of over the ping heartbeat's 25, which matters
   * because until it converges a follower cannot safely extrapolate playback.
   */
  const measureClock = useCallback(
    (samples = CLOCK_BURST) => {
      for (let i = 0; i < samples; i++) {
        if (i === 0) pingOnce();
        else setTimeout(pingOnce, i * CLOCK_BURST_SPACING_MS);
      }
    },
    [pingOnce],
  );

  const updatePeers = useCallback(() => {
    const now = Date.now();
    for (const [id, p] of peersRef.current) {
      if (now - p.lastSeen > PEER_TIMEOUT_MS) peersRef.current.delete(id);
    }
    setPeers([...peersRef.current.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  // ── Incoming session traffic ────────────────────────────────────────────────
  useEffect(() => {
    return channel.subscribe((e) => {
      switch (e.a) {
        case "hello": {
          peersRef.current.set(e.client, {
            clientId: e.client,
            name: e.name,
            role: e.role,
            rttMs: peersRef.current.get(e.client)?.rttMs ?? null,
            lastSeen: Date.now(),
          });
          // Joining a session that already has a master: fall in behind it.
          // Without this, only devices present at the moment of the claim ever
          // follow, and anything that joins (or reloads) afterwards sits inert.
          if (
            e.role === "master" &&
            e.client !== channel.clientId &&
            !brokeAwayRef.current &&
            roleRef.current !== "master"
          ) {
            setRole("follower");
            measureClock();
          }
          updatePeers();
          // Answer so the newcomer learns about us — but never answer an
          // answer. Replying unconditionally makes two peers volley helloes at
          // each other for as long as they are both connected.
          if (!e.reply) {
            send({
              a: "hello",
              client: channel.clientId,
              name: author.name,
              role: roleRef.current,
              reply: true,
            });
          }
          break;
        }
        case "bye": {
          peersRef.current.delete(e.client);
          // The master closed its tab. Without this a follower sits frozen,
          // unable to touch its own transport, waiting on a peer that is gone.
          if (roleRef.current === "follower" && !hasOtherMaster(e.client)) setRole("free");
          updatePeers();
          break;
        }
        case "claim": {
          // Last claim wins. Anyone who was master steps down without argument;
          // arguing over it mid-critique is worse than a stolen pointer.
          for (const [id, p] of peersRef.current) {
            peersRef.current.set(id, {
              ...p,
              role: id === e.client ? "master" : p.role === "master" ? "free" : p.role,
            });
          }
          peersRef.current.set(e.client, {
            clientId: e.client,
            name: e.name,
            role: "master",
            rttMs: peersRef.current.get(e.client)?.rttMs ?? null,
            lastSeen: Date.now(),
          });
          // Someone took control: fall in behind them, unless this device
          // deliberately broke away — that is the point of breaking away.
          if (e.client !== channel.clientId && !brokeAwayRef.current) {
            setRole("follower");
            // Measure the clock against the new master straight away. Until a
            // sample lands the offset is 0, and two machines' clocks differing
            // by a second is 25 frames of error at 25 fps.
            measureClock();
          }
          updatePeers();
          break;
        }
        case "release": {
          const p = peersRef.current.get(e.client);
          if (p) peersRef.current.set(e.client, { ...p, role: "free" });
          // Nobody is driving any more — take back your own screen rather than
          // following a master that no longer exists.
          if (roleRef.current === "follower" && !hasOtherMaster(e.client)) setRole("free");
          updatePeers();
          break;
        }
        case "ping": {
          // Reply with our own clock so the asker can compute the offset.
          send({ a: "pong", client: channel.clientId, t: e.t, to: e.client, remote: Date.now() });
          const p = peersRef.current.get(e.client);
          if (p) p.lastSeen = Date.now();
          break;
        }
        case "pong": {
          if (e.to !== channel.clientId) break;
          const sentAt = pendingPings.current.get(String(e.t));
          if (sentAt === undefined) break;
          pendingPings.current.delete(String(e.t));
          const received = Date.now();
          // Only sync our clock to the master; following two clocks is worse
          // than following none.
          const peer = peersRef.current.get(e.client);
          if (peer?.role === "master" && roleRef.current !== "master") {
            clock.sample(sentAt, e.remote, received);
          }
          const rtt = received - sentAt;
          setRttMs(rtt);
          if (peer) peersRef.current.set(e.client, { ...peer, rttMs: rtt, lastSeen: received });
          updatePeers();
          break;
        }
      }
    });
  }, [channel, send, author.name, clock, updatePeers, hasOtherMaster]);

  // ── Announce, ping, and say goodbye ─────────────────────────────────────────
  useEffect(() => {
    send({ a: "hello", client: channel.clientId, name: author.name, role: roleRef.current });

    measureClock();
    // Heartbeat is a single ping; the burst is only for initial convergence.
    const timer = setInterval(pingOnce, PING_INTERVAL_MS);

    const bye = () => send({ a: "bye", client: channel.clientId });
    window.addEventListener("pagehide", bye);

    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", bye);
      bye();
    };
  }, [channel, send, author.name, measureClock, pingOnce]);

  useEffect(() => channel.onConnectionChange(setConnected), [channel]);

  // A machine that slept has a stale clock estimate; re-measure on wake.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      clock.reset();
      measureClock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [clock, measureClock]);

  const claim = useCallback(() => {
    setRole("master");
    brokeAwayRef.current = false;
    clock.reset(); // master defines the epoch
    send({ a: "claim", client: channel.clientId, name: author.name });
  }, [channel, send, author.name, clock]);

  const release = useCallback(() => {
    // Giving up control leaves nobody driving, so take back your own screen
    // rather than following a master that no longer exists.
    setRole("free");
    brokeAwayRef.current = false;
    send({ a: "release", client: channel.clientId });
  }, [channel, send]);

  const breakAway = useCallback(() => {
    brokeAwayRef.current = true;
    setRole("free");
  }, []);

  const rejoin = useCallback(() => {
    brokeAwayRef.current = false;
    setRole(hasOtherMaster(channel.clientId) ? "follower" : "free");
    measureClock();
  }, [channel.clientId, hasOtherMaster, measureClock]);

  const masterName = useMemo(() => {
    if (role === "master") return author.name;
    return peers.find((p) => p.role === "master")?.name ?? null;
  }, [peers, role, author.name]);

  // Memoised: this object is a dependency of the render-loop effect in
  // useViewer. Returning a fresh literal every render tore the rAF loop down
  // and rebuilt it on every frame during playback.
  return useMemo(
    () => ({
      role,
      isMaster: role === "master",
      followView,
      setFollowView,
      peers,
      masterName,
      connected,
      rttMs,
      clock,
      claim,
      release,
      breakAway,
      rejoin,
      send,
      subscribe,
    }),
    [
      role,
      followView,
      peers,
      masterName,
      connected,
      rttMs,
      clock,
      claim,
      release,
      breakAway,
      rejoin,
      send,
      subscribe,
    ],
  );
}
