import { guardrailStatus, type Guardrail, type GuardrailId } from "@/lib/sleep/guardrails";

const LABELS: Record<GuardrailId, string> = {
  "caffeine-cutoff": "Caffeine cutoff",
  "nap-cutoff": "Finish naps by",
  "screen-off": "Screen-off",
  "laptop-off": "Laptop-off",
  "shutdown-warning-30": "First shutdown warning",
  "shutdown-warning-10": "Final shutdown warning",
};

export function GuardrailRails({ rails, now }: {
  rails: Guardrail[];
  now: { date: string; time: string };
}) {
  return (
    <section aria-label="Daytime and evening guardrails" className="mt-5 border-t border-[#c7d0d8] pt-5">
      <h3 className="text-lg font-semibold">Daytime and evening guardrails</h3>
      <p className="mt-1 text-sm leading-6 text-[#596672]">
        Recommended defaults, not guaranteed sleep protection. Naps are optional;
        the overnight block stays at 9h.
      </p>
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {rails.map((rail) => (
          <li key={rail.id} data-rail-id={rail.id} data-minute-offset={rail.minuteOffset}
            data-day-offset={rail.dayOffset} className="inset-panel p-3">
            <p className="text-sm font-medium">{LABELS[rail.id]}</p>
            <time dateTime={`${rail.date}T${rail.time}`} className="tabular-time mt-1 block font-semibold">
              {rail.time}<span className="ml-2 text-xs font-normal text-[#596672]">{rail.date}</span>
            </time>
            <p className="text-xs text-[#596672]">{guardrailStatus(rail, now)}</p>
          </li>
        ))}
      </ul>
      <details className="mt-3 text-sm leading-6 text-[#596672]">
        <summary className="cursor-pointer font-medium">Why these defaults?</summary>
        <p className="mt-2">
          Caffeine: 9h before bed is a starting point for typical coffee (about
          100 mg), rounding the 8.8h population estimate in the{" "}
          <a className="underline" href="https://doi.org/10.1016/j.smrv.2023.101764">2023 review</a>.
          Larger or repeated doses and greater sensitivity may need an earlier
          cutoff; schedule inputs cannot calculate that adjustment. The small{" "}
          <a className="underline" href="https://academic.oup.com/sleep/article/48/4/zsae230/7815486">100/400 mg trial</a>{" "}
          does not establish a universally safe cutoff.
        </p>
        <p className="mt-2">
          Naps: finish 8h before bed is a product heuristic, not a proven interval.
          A small{" "}
          <a className="underline" href="https://pmc.ncbi.nlm.nih.gov/articles/PMC12856117/">student-athlete study</a>{" "}
          tested naps ending at 15:00; it did not establish a universal latest end time.
        </p>
        <p className="mt-2">
          Screens: the 1h target is a product heuristic for ending discretionary,
          stimulating screen use. The{" "}
          <a className="underline" href="https://doi.org/10.1016/j.sleep.2025.02.043">REST-O pilot</a>{" "}
          supports disengagement cues, not an optimal interval. Laptop-off is the
          earlier of screen-off and shutdown start. The 30/10-minute warnings are
          product transition cues. These intervals are not clinically optimized.
          Close the laptop; the minimal shutdown guide remains available on your phone.
        </p>
      </details>
    </section>
  );
}
