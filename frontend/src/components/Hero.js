import React, { useState, useEffect } from "react";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Copy, Share2, Sparkles, Twitter, Mail as MailIcon, Send, Trophy } from "lucide-react";
import WaveformCanvas from "./WaveformCanvas";
import CountUp from "./CountUp";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

function maskEmail(email) {
  try {
    const [local, domain] = email.split("@");
    const lo = local.slice(0, 2);
    const [dname, ...rest] = domain.split(".");
    const tld = rest.length ? `.${rest[rest.length - 1]}` : "";
    return `${lo}•••@${dname[0]}•••${tld}`;
  } catch { return "•••"; }
}

function ProgressDots({ count = 0 }) {
  return (
    <div className="flex items-center gap-1.5" aria-label={`${count}/3 referrals`}>
      {[0, 1, 2].map((i) => {
        const filled = i < count;
        return (
          <span
            key={i}
            className={`h-2 rounded-full transition-all duration-300 ${
              filled ? "w-8 bg-phasor-green shadow-[0_0_12px_rgba(0,255,135,0.7)]" : "w-4 bg-white/10"
            }`}
          />
        );
      })}
    </div>
  );
}

function SharePanel({ data, shareUrl, onReset }) {
  const [copied, setCopied] = useState("");
  const [boardRank, setBoardRank] = useState(null); // { rank, totalOnBoard }

  // Look up if this user is on the public leaderboard (top 10)
  useEffect(() => {
    let ignore = false;
    const check = async () => {
      try {
        const res = await axios.get(`${API}/waitlist/leaderboard`, { params: { window: "all", limit: 10 } });
        if (ignore) return;
        const entries = res.data?.entries || [];
        // The leaderboard exposes masked handles, so match by referrals+beta as a heuristic OR reuse mask
        // We'll match by first-2 chars of email prefix + first char of domain (which is exactly the mask)
        const mask = maskEmail(data.email);
        const idx = entries.findIndex((e) => e.handle === mask && e.referrals === data.referral_count);
        if (idx >= 0) {
          setBoardRank({ rank: idx + 1, totalOnBoard: entries.length });
        } else {
          setBoardRank(null);
        }
      } catch {
        // silent
      }
    };
    check();
    return () => { ignore = true; };
  }, [data.email, data.referral_count]);

  const copy = async (val, key) => {
    const done = () => {
      setCopied(key);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(""), 1500);
    };
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(val);
        done();
        return;
      }
      throw new Error("clipboard unavailable");
    } catch (err) {
      // Fallback: hidden textarea + execCommand
      try {
        const ta = document.createElement("textarea");
        ta.value = val;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-1000px";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) done();
        else toast.error("Copy failed — please copy manually");
      } catch {
        toast.error("Copy failed — please copy manually");
      }
    }
  };

  const message =
    "I just joined the Phasor waitlist — real-time AI voice-clone defense for phone calls, meetings, browsers & inboxes. Join with my link:";

  const socialLinks = [
    {
      key: "twitter",
      Icon: Twitter,
      label: "Twitter / X",
      href: `https://twitter.com/intent/tweet?text=${encodeURIComponent(message)}&url=${encodeURIComponent(shareUrl)}`,
    },
    {
      key: "email",
      Icon: MailIcon,
      label: "Email",
      href: `mailto:?subject=${encodeURIComponent("Try Phasor with me")}&body=${encodeURIComponent(message + "\n\n" + shareUrl)}`,
    },
    {
      key: "sms",
      Icon: Send,
      label: "SMS",
      href: `sms:?&body=${encodeURIComponent(message + " " + shareUrl)}`,
    },
  ];

  const remaining = data.referrals_to_beta;
  const hasBeta = data.beta_access;

  return (
    <div
      data-testid="share-panel"
      className="glass-strong rounded-2xl p-6 sm:p-7 text-left relative overflow-hidden"
    >
      <div className="absolute -top-24 -right-24 w-72 h-72 radial-glow-green blur-3xl opacity-40 pointer-events-none" />

      {/* Header row */}
      <div className="relative flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-phasor-green">
            <CheckCircle2 className="w-4 h-4" />
            {data.already_joined ? "Welcome back" : "You're in"}
          </div>
          <div className="mt-2 font-display text-2xl sm:text-3xl font-semibold tracking-tight">
            You're{" "}
            <span
              className="text-phasor-green"
              style={{ textShadow: "0 0 24px rgba(0,255,135,0.55)" }}
            >
              #{data.position}
            </span>{" "}
            in line
          </div>
          {data.base_position !== data.position && (
            <div className="mt-1 text-xs text-phasor-mute font-mono">
              (was #{data.base_position} — you skipped {data.base_position - data.position} spot{data.base_position - data.position === 1 ? "" : "s"})
            </div>
          )}
        </div>
        <button
          data-testid="share-reset"
          onClick={onReset}
          className="text-xs font-mono text-phasor-mute hover:text-white transition-colors"
        >
          use different email
        </button>
      </div>

      {/* Beta status */}
      <div
        className={`relative mt-5 rounded-xl border p-4 ${
          hasBeta
            ? "border-phasor-green/50 bg-phasor-green/[0.07]"
            : "border-white/10 bg-white/[0.03]"
        }`}
      >
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Sparkles className={`w-5 h-5 ${hasBeta ? "text-phasor-green" : "text-phasor-cyan"}`} />
            <div>
              <div className="font-display text-sm font-semibold">
                {hasBeta ? "Beta access unlocked" : `Refer ${remaining} friend${remaining === 1 ? "" : "s"} to unlock Beta`}
              </div>
              <div className="text-xs text-phasor-mute mt-0.5">
                {hasBeta
                  ? "You're among the first 100 with early Beta access."
                  : `First 100 to hit 3 referrals get in. ${data.beta_slots_left} slot${data.beta_slots_left === 1 ? "" : "s"} left.`}
              </div>
            </div>
          </div>
          <ProgressDots count={Math.min(3, data.referral_count)} />
        </div>
      </div>

      {/* Leaderboard pill */}
      <AnimatePresence>
        {boardRank && (
          <motion.a
            data-testid="leaderboard-pill"
            href="#leaderboard"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className="relative mt-4 flex items-center justify-between gap-3 rounded-xl border border-yellow-400/40 bg-gradient-to-r from-yellow-400/[0.08] to-transparent px-4 py-3 hover:border-yellow-300/60 transition-colors group"
          >
            <div className="flex items-center gap-3">
              <div
                className="w-9 h-9 rounded-full bg-yellow-400 text-black font-display font-bold flex items-center justify-center"
                style={{ boxShadow: "0 0 20px rgba(250,204,21,0.5)" }}
              >
                <Trophy className="w-4 h-4" />
              </div>
              <div>
                <div className="font-display text-sm font-semibold text-white">
                  You're #{boardRank.rank} on the public leaderboard
                </div>
                <div className="text-[11px] text-phasor-mute font-mono">Tap to view · updates live</div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-yellow-300 group-hover:translate-x-0.5 transition-transform" />
          </motion.a>
        )}
      </AnimatePresence>

      {/* Share link */}
      <div className="relative mt-5">
        <div className="text-[10px] font-mono uppercase tracking-widest text-phasor-mute mb-2">
          Your unique referral link
        </div>
        <div className="flex items-stretch gap-2">
          <div
            data-testid="share-url"
            className="flex-1 rounded-full bg-black/40 border border-white/10 px-4 py-3 text-xs sm:text-sm font-mono text-white/85 truncate"
          >
            {shareUrl}
          </div>
          <button
            data-testid="share-copy"
            onClick={() => copy(shareUrl, "url")}
            className="btn-primary rounded-full px-4 sm:px-5 flex items-center gap-2 text-sm shrink-0"
          >
            {copied === "url" ? <CheckCircle2 className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied === "url" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {/* Social share */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-mono uppercase tracking-widest text-phasor-mute mr-1">
          <Share2 className="w-3 h-3 inline mr-1 -mt-0.5" /> Share via
        </span>
        {socialLinks.map(({ key, Icon, label, href }) => (
          <a
            key={key}
            data-testid={`share-${key}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] hover:border-phasor-cyan/40 hover:bg-phasor-cyan/[0.05] transition-colors px-3 py-1.5 text-xs"
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </a>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-phasor-mute">
        <span>Code · {data.referral_code}</span>
        <span>+1 spot skipped per friend</span>
      </div>
    </div>
  );
}

export default function Hero() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [count, setCount] = useState(3127);
  const [incomingRef, setIncomingRef] = useState(null);

  // Read ?ref= on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      setIncomingRef(ref.toUpperCase());
      toast.info("Referral applied — your friend just skipped 1 spot.");
    }
  }, []);

  useEffect(() => {
    axios
      .get(`${API}/waitlist/stats`)
      .then((r) => {
        const n = Number(r.data?.displayed_count);
        if (Number.isFinite(n)) setCount(n);
      })
      .catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      toast.error("Please enter a valid email");
      return;
    }
    setLoading(true);
    try {
      const res = await axios.post(`${API}/waitlist`, {
        email,
        source: "landing_hero",
        ref: incomingRef || undefined,
      });
      setResult(res.data);
      if (res.data.already_joined) {
        toast.success(`Welcome back — you're #${res.data.position}${res.data.beta_access ? " · Beta unlocked" : ""}`);
      } else {
        toast.success(`Secured. You are #${res.data.position} in line.`);
        setCount((c) => c + 1);
      }
    } catch (err) {
      toast.error("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setResult(null);
    setEmail("");
  };

  const shareUrl = result
    ? `${window.location.origin}${window.location.pathname}?ref=${result.referral_code}`
    : "";

  return (
    <section id="hero" className="relative pt-20 pb-24 sm:pt-28 sm:pb-32 px-6">
      <div className="max-w-6xl mx-auto text-center">
        <div
          data-testid="hero-pill"
          className="reveal inline-flex items-center gap-2 rounded-full glass px-3.5 py-1.5 mb-8 text-xs font-mono tracking-wider uppercase text-phasor-mute"
        >
          <span className="dot-accent animate-blink" />
          Real-time · Omni-channel · On-device
        </div>

        <h1
          data-testid="hero-headline"
          className="reveal font-display text-[42px] leading-[1.02] sm:text-6xl md:text-7xl lg:text-[88px] font-extrabold tracking-[-0.03em]"
        >
          <motion.span
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1] }}
            className="inline-block"
          >
            Real-Time Synthetic
          </motion.span>{" "}
          <br className="hidden sm:block" />
          <motion.span
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.1, ease: [0.2, 0.8, 0.2, 1] }}
            className="inline-block"
          >
            Media <span className="text-gradient-green">Defense.</span>
          </motion.span>
        </h1>

        <p
          data-testid="hero-sub"
          className="reveal mt-6 max-w-2xl mx-auto text-base sm:text-lg text-phasor-mute leading-relaxed"
        >
          Phasor scans active phone calls, video streams, extensions, and emails in real time to spot AI clone scams instantly. Protect your family.
        </p>

        <div className="reveal mt-6 flex items-center justify-center gap-3 flex-wrap">
          <a
            href="/console"
            data-testid="hero-launch-app"
            className="group relative rounded-full border border-phasor-cyan/40 bg-phasor-cyan/[0.08] hover:bg-phasor-cyan/[0.14] transition-colors text-phasor-cyan text-sm px-5 py-2.5 inline-flex items-center gap-2"
            style={{ boxShadow: "0 0 40px -8px rgba(0,242,254,0.55)" }}
          >
            <Sparkles className="w-4 h-4" />
            Launch the full Web App
            <span className="text-[10px] font-mono uppercase tracking-widest text-phasor-cyan/60 border border-phasor-cyan/30 rounded-full px-2 py-0.5 ml-1">
              beta
            </span>
          </a>
          <span className="text-xs font-mono text-phasor-mute">
            connects with Google Meet · Zoom · Chrome · Email
          </span>
        </div>

        <div id="waitlist" className="reveal mt-10 max-w-xl mx-auto">
          {!result ? (
            <>
              {incomingRef && (
                <div
                  data-testid="ref-banner"
                  className="mb-3 inline-flex items-center gap-2 rounded-full bg-phasor-cyan/10 border border-phasor-cyan/30 px-3 py-1 text-[11px] font-mono text-phasor-cyan"
                >
                  <Sparkles className="w-3 h-3" />
                  Referral <span className="text-white/90">{incomingRef}</span> applied · your friend skips 1 spot when you join
                </div>
              )}
              <form
                data-testid="waitlist-form"
                onSubmit={submit}
                className="glass-strong rounded-full p-1.5 pl-5 flex items-center gap-3 shadow-[0_0_60px_-20px_rgba(0,255,135,0.6)]"
              >
                <input
                  data-testid="waitlist-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@family.com"
                  className="flex-1 rounded-full px-2 py-3 text-sm sm:text-base placeholder-white/35 focus:ring-0 bg-transparent border-none outline-none text-white"
                />
                <button
                  data-testid="waitlist-submit"
                  type="submit"
                  disabled={loading}
                  className="btn-primary rounded-full px-5 sm:px-6 py-3 text-sm sm:text-base flex items-center gap-2 disabled:opacity-70"
                >
                  {loading ? "Securing…" : "Secure Your Communications"}
                  <ArrowRight className="w-4 h-4" />
                </button>
              </form>
              <div
                data-testid="hero-social-proof"
                className="mt-4 flex items-center justify-center gap-3 text-xs sm:text-sm text-phasor-mute font-mono"
              >
                <div className="flex -space-x-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="w-6 h-6 rounded-full border border-phasor-bg"
                      style={{ background: `hsl(${140 + i * 12}, 80%, ${45 + i * 5}%)` }}
                    />
                  ))}
                </div>
                <span>
                  Join{" "}
                  <span className="text-white font-semibold">
                    <CountUp value={count} duration={1.6} suffix="+" />
                  </span>{" "}
                  early adopters securing their calls.
                </span>
              </div>
            </>
          ) : (
            <SharePanel data={result} shareUrl={shareUrl} onReset={reset} />
          )}
        </div>
      </div>

      <div className="reveal max-w-6xl mx-auto mt-16 relative">
        <div className="absolute -inset-6 radial-glow-green blur-3xl opacity-60 pointer-events-none" />
        <div className="relative glass rounded-3xl overflow-hidden noise">
          <WaveformCanvas />
        </div>
      </div>
    </section>
  );
}
