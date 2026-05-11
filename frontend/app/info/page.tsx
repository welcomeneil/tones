import type { Metadata } from "next";
import Link from "next/link";
import { ScrollReveal } from "../components/ScrollReveal";
import { FaqItem } from "./FaqItem";

export const metadata: Metadata = {
  title: "info · tone zone",
  description:
    "Who tone zone is for, how to use it, and a few links for studying value.",
};

type Faq = { q: string; a: string };

const FAQS: Faq[] = [
  {
    q: "What is a tonal zone?",
    a: "A tonal zone is a band of related values grouped together — the building block of value composition. Reducing a photo to a handful of zones reveals the underlying value structure of a scene without the noise of every individual pixel.",
  },
  {
    q: "How many values should I pick?",
    a: "Two or three zones force the strongest read and are useful for thumbnails. Five to seven are closer to a finished study. Start low, then add — it is easier to see structure with fewer zones.",
  },
  {
    q: "What does the number under the palette mean?",
    a: "It is the Munsell value, a 0–10 scale where 0 is black and 10 is white. Useful when matching paint or pencil values to what you see.",
  },
  {
    q: "Are my images uploaded anywhere?",
    a: "Analysis runs locally in your browser via a Web Worker. Images do not leave your device.",
  },
];

type VideoLink = { title: string; channel: string; href: string };

const VIDEOS: VideoLink[] = [
  {
    title: "How I Learned GRAYSCALE | Self Taught Value Studies",
    channel: "Adrift Arts",
    href: "https://www.youtube.com/watch?v=rpMAHUAxIsg",
  },
  {
    title: "Train Your Eyes to See Values",
    channel: "Proko",
    href: "https://www.youtube.com/watch?v=RFQtsXktc9g&t=5s",
  },
  {
    title: "How To See in Value — Part 1: Observation Strategies",
    channel: "DRAW with Chris",
    href: "https://www.youtube.com/watch?v=zG7qa9daAbw",
  },
];

export default function InfoPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-12 px-6 py-16 sm:px-10 sm:py-24">
      <header className="stagger-in stagger-1 flex items-baseline justify-between">
        <h1 className="font-serif text-3xl tracking-tight text-[var(--foreground)]">
          tone zone
        </h1>
        <p className="text-right text-[10px] uppercase tracking-[0.2em] leading-relaxed text-[var(--muted)]">
          a reference tool
          <br />
          <span className="text-[var(--foreground)]">by neil</span>
        </p>
      </header>

      <hr className="stagger-in stagger-2 border-t border-[var(--border)]" />

      <main className="flex flex-col gap-16">
        <section className="stagger-in stagger-3 flex flex-col gap-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
            about
          </p>
          <h2 className="font-serif text-4xl leading-snug text-[var(--foreground)] sm:text-5xl">
            A quiet aid for training the eye.
          </h2>
          <p className="max-w-2xl text-base leading-relaxed text-[var(--foreground)]">
            Tone zone reduces a photograph to its underlying value structure —
            the same way a painter squints at a scene to collapse detail and
            see the big shapes. Upload a reference, and read the values.
          </p>
        </section>

        <section className="stagger-in stagger-4 flex flex-col gap-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
            who this is for
          </p>
          <ul className="flex flex-col gap-4 text-base leading-relaxed text-[var(--foreground)]">
            <li className="flex flex-col gap-1 border-l border-[var(--border)] pl-4">
              <span className="font-serif text-xl italic">Artists</span>
              <span className="text-[var(--muted)]">
                — as a cross-reference when working from a photograph, to
                check value relationships against what the eye reports.
              </span>
            </li>
            <li className="flex flex-col gap-1 border-l border-[var(--border)] pl-4">
              <span className="font-serif text-xl italic">Students</span>
              <span className="text-[var(--muted)]">
                — to build the habit of seeing in values before color, and to
                make value studies less guesswork.
              </span>
            </li>
            <li className="flex flex-col gap-1 border-l border-[var(--border)] pl-4">
              <span className="font-serif text-xl italic">Teachers</span>
              <span className="text-[var(--muted)]">
                — as a demonstration tool for talking about value structure,
                squinting, and how images simplify into a handful of zones.
              </span>
            </li>
            <li className="flex flex-col gap-1 border-l border-[var(--border)] pl-4">
              <span className="font-serif text-xl italic">
                Anyone training their eye
              </span>
              <span className="text-[var(--muted)]">
                — designers, photographers, hobbyists. If you want to see
                composition more clearly, this is for you.
              </span>
            </li>
          </ul>
        </section>

        <ScrollReveal as="section" className="flex flex-col gap-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
            questions
          </p>
          <div className="flex flex-col">
            {FAQS.map((item, i) => (
              <div
                key={item.q}
                className={i === 0 ? "" : "border-t border-[var(--border)]"}
              >
                <FaqItem question={item.q} answer={item.a} />
              </div>
            ))}
          </div>
        </ScrollReveal>

        <ScrollReveal as="section" className="flex flex-col gap-6">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
            further study
          </p>
          <h3 className="font-serif text-2xl text-[var(--foreground)]">
            Value-study videos worth your time.
          </h3>
          <ul className="flex flex-col">
            {VIDEOS.map((v, i) => (
              <li
                key={`${v.title}-${i}`}
                className={`py-5 ${
                  i === 0 ? "" : "border-t border-[var(--border)]"
                }`}
              >
                <a
                  href={v.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-baseline justify-between gap-6"
                >
                  <span className="flex flex-col gap-1">
                    <span className="font-serif text-lg text-[var(--foreground)] group-hover:underline group-hover:underline-offset-4">
                      {v.title}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
                      {v.channel}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)] group-hover:text-[var(--foreground)]"
                  >
                    youtube ↗
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </ScrollReveal>
      </main>

      <footer className="stagger-in stagger-5 mt-auto flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-[var(--border)] pt-6 text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">
        <span>value-study reference</span>
        <span aria-hidden="true">·</span>
        <span>neil bisht</span>
        <span aria-hidden="true">·</span>
        <span>2026</span>
        <span aria-hidden="true">·</span>
        <Link
          href="/"
          className="underline underline-offset-4 hover:text-[var(--foreground)]"
        >
          home
        </Link>
        <span aria-hidden="true">·</span>
        <a
          href="https://github.com/welcomeneil/tones"
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-4 hover:text-[var(--foreground)]"
        >
          view source
        </a>
      </footer>
    </div>
  );
}
