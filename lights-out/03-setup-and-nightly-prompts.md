# Lights Out: a ChatGPT Project for falling asleep

This Project takes over where the SleepOps shutdown ends ("Lights out"). It gives your brain something to follow that keeps you occupied without winding you up, as a replacement for stories, instructionals and rabbit holes. It then fades out: you go from typing a line, to talking, to murmuring, to nothing.

## Files

| File | What to do with it |
|---|---|
| `01-project-instructions.md` | Paste into Project settings > Instructions. It's about 7,850 of the 8,000-character limit, so trim ABOUT ME first if you add anything. |
| `02-lights-out-playbook.md` | Upload it as a project file. It holds the scripts, seed lists, story settings and log format. |
| `03-setup-and-nightly-prompts.md` | This guide, for you. It doesn't go into ChatGPT. |

## How a night runs

```
step        what you do                   screen        when
land        talk while you get ready      off (voice)   optional, after training
zz          one line                      ~10 s, or 0   every night
unload      a few sentences               off           only if your mind is racing
downshift   follow along                  off           energy 6+ or trained tonight
drift       murmur "more" now and then    off           story / shuffle / scan / talk
silence     nothing                       off           this is the goal
am          one line the next morning     on            optional log
```

- It replaces rather than forbids. Your brain gets input, just at a low level of arousal.
- It's built not to become the rabbit hole. There are no new facts, tangents get parked in one line, and it never debates. Your brain can out-argue a rule, but there's nothing here to argue with.
- It closes open loops. "dump" turns what's racing around your head into a specific list for tomorrow.
- It stays screen-free. Voice with the phone locked keeps to the SleepOps screen-off rail.
- It moves the reward to the morning. Clips go into Post AM, so posting becomes a reason to get up.
- It learns. With project-only memory and `am` logs, it picks what has worked on similar nights.

## Setup (once, about 10 minutes)

1. In ChatGPT, create a new project called "Lights Out" and set Memory to Project-only. You can change it later in the project settings.
2. Go to Settings > Personalization and turn on Reference saved memories and Reference chat history. The project needs these to learn from past nights.
3. In the project, open ••• > Project settings > Instructions and paste file 01.
4. Add files: upload file 02.
5. Go to Settings > Voice and turn on Background conversations, so voice keeps going with the phone locked. In daylight, try 2-3 voices and keep the calmest one. Test it by saying "lights out, energy five, bored". If it rushes, say "slower, longer pauses".
6. Set up the iPhone firewall. It's optional, but it's what makes the sleepy path the easy one:
   - Screen Time > Downtime: start it at your SleepOps screen-off time, and set Always Allowed to ChatGPT, Audible, Headspace, your music app and Phone.
   - Focus > Sleep: same schedule, notifications silenced.
   - Hard mode: have someone else set the Screen Time passcode.
   - In Photos, create an album called "Post AM".
7. Optional: Settings > General > Keyboard > Text Replacement. Map `zzz` to the full starter below, and `amm` to `am 00:00 ~00:00 00:00 technique 0`.

Start a new chat each night. Log `am` in the previous night's chat, where your parked list is right there.

## Nightly prompts

Voice (default)
1. Get into bed and turn the lights off. Open the Lights Out project and tap the voice icon.
2. Say something like "Lights out. Energy seven, wired, BJJ tonight." Plain speech works too, for example "I'm bored and can't sleep".
3. Lock the phone and listen. Say "more" to continue, "awake" for the next step, or "quiet" for silence.

Mix: type `zz 7 wired bjj mix`. It answers in two lines. Then tap voice and lock the screen.

Text: type `zz 7 wired bjj text`. Replies stay at three lines or fewer. For a story, long-press the reply > Read aloud, and put the phone face down.

Minimal starter (defaults fill in the rest):

```
zz 7 wired bjj
```

Full starter:

```
zz
energy: 1-10
mind: bored | wired | racing | low | ok
sport: none | bjj | climbing | other
in bed: yes | no
mode: voice | mix | text
firmness: firm | gentle | strict
want: auto | story | shuffle | breathe | chalk | scan | talk | dump
on my mind: (optional, one line)
```

## Commands (type them or say them)

| Command | Effect |
|---|---|
| `zz` / "lights out" | start the wind-down |
| `land` | post-training landing, one step at a time |
| `am` / "morning log" | morning log |
| `dump` | unload your thoughts into a tomorrow list |
| `story` `shuffle` `breathe` `chalk` `scan` `talk` | jump to a technique (`chalk` = chalk-off muscle relaxation) |
| `awake` | next step on the still-awake ladder |
| `slower` `duller` | slow it down, or make it more boring |
| `quiet` | silence until you speak |
| `voice` `mix` `text` | switch mode for this chat |
| `firm` `gentle` `strict` | switch firmness for this chat |
| `settings` | show the current settings |

## Settings

- For tonight only, say or type the word, e.g. `gentle`.
- To change a default permanently, edit the SETTINGS lines at the top of the instructions, e.g. `- firmness: gentle`.

| Firmness | Tangents | Negotiation ("one more video") |
|---|---|---|
| firm (default) | parked in one line | acknowledged in one sentence, then two sleepy options |
| gentle | up to 2 sentences, then parked | softer nudges |
| strict | never answered | on the first push, or after about 6 messages: "Lock the phone. The story starts now." |

## Optional modules

- `land`: use it when you get home wired. It walks you through six steps, one at a time: water or a snack, clips into Post AM, warm shower, dim lights, legs up the wall, teeth and bed. It ends with "say zz". In voice it works with the phone in your pocket.
- `am`: for example `am 00:40 ~01:30 10:35 shuffle 4 bjj` (lights out, roughly when you fell asleep, wake time, what you used, rating out of 5, notes). You get back one log line to copy into SleepOps, last night's parked list and, once there are 5 or more logs, one sentence on any pattern.

## Why each piece is there

| Piece | What it does | Evidence |
|---|---|---|
| dump into a tomorrow list | closes open loops | 5 min of to-do list writing: about 9 min faster sleep onset, and more specific lists did better (Scullin 2018, n=57) |
| cyclic sighing | lowers arousal | better mood and a lower breathing rate than mindfulness (Balban 2023, n=111). A daytime study, not a sleep one |
| chalk-off relaxation, body scan | releases the post-training tension | relaxation is a standard CBT-I component |
| cognitive shuffle | mimics the scattered imagery of drifting off | plausible, but the evidence is early |
| boring stories | hold attention without arousal | a design choice, not trial-tested |
| get-up rule | stops the bed from turning into a place for being awake | stimulus control, a core part of CBT-I |
| warm shower in `land` | helps the body cool down afterwards | 1-2 h before bed: about 10 min faster sleep onset (Haghayegh 2019, meta-analysis) |

## What the Project can't fix

- Late hard training. Maximal-strain sessions ending 2h before your usual sleep onset were associated with about 36 min later sleep onset, and sessions ending 4h or more before sleep showed no association (Leota 2025, 14,689 WHOOP users, observational). `land` buys some of that back. The session time is the real lever.
- The floating wake time. You wake about 9h after falling asleep, so every late night pushes the whole clock later. The anchor is in the morning: the SleepOps kaizen wake target, plus daylight soon after waking. Post AM gives that morning a reward.
- ADHD. Sleep-onset insomnia with a delayed melatonin rhythm is common in adults with ADHD (31 of 40 in one clinical sample; Van Veen 2010). If you get a formal assessment, mention this sleep pattern. Timed light and melatonin are topics for a clinician, not this bot.
- The honest ceiling. This is a wind-down tool, not therapy or insomnia treatment. If it still takes hours on most nights after 2-3 weeks, CBT-I (with a clinician or a digital program) is the first-line next step.

## Troubleshooting

- Too chatty or too interesting: say `duller`, or switch to `strict`.
- Talks too fast: say "slower, longer pauses". ChatGPT Voice has no speed control.
- Answers noises or long silences: say `quiet`. Live voice can still react to background sounds.
- Hit the voice limit (Plus gets 3h of GPT-Live per rolling 24h): switch to `text` and Read aloud, or fall back to Headspace.
- Czech voice: GPT-Live can have a non-native accent in some languages, so English is the safer default for sleep.
- Parked items missing in the morning: log `am` in the previous night's chat. Voice transcripts are saved there, though not always word for word.

## Sources

- ChatGPT Projects (memory, files, instructions): https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt
- ChatGPT Voice (Plus limits, Background conversations, pauses, speed): https://help.openai.com/en/articles/8400625-voice-mode-faq
- Release notes (voice in Projects, Aug 2026; memory switch; custom instructions at 5,000): https://help.openai.com/en/articles/6825453-chatgpt-release-notes
- Project instructions limit (8,000 characters): https://elephas.app/resources/chatgpt-projects-limits-files-size-and-how-many-projects
- GPT-Live: https://openai.com/index/introducing-gpt-live/
- Scullin et al. 2018, bedtime to-do lists: https://pubmed.ncbi.nlm.nih.gov/29058942/
- Balban et al. 2023, cyclic sighing: https://www.cell.com/cell-reports-medecine/fulltext/S2666-3791(22)00474-8
- Haghayegh et al. 2019, warm bath or shower: https://pubmed.ncbi.nlm.nih.gov/31102877/
- Leota et al. 2025, evening exercise dose-response: https://www.nature.com/articles/s41467-025-58271-x
- Van Veen et al. 2010, ADHD and sleep-onset insomnia: https://pubmed.ncbi.nlm.nih.gov/20163790/
- Cognitive shuffle overview: https://sbocd.com/2026/03/25/the-cognitive-shuffle-a-sleep-onset-tool-what-it-is-how-it-works-and-who-it-helps/
- Linka první psychické pomoci (116 123, free, nonstop): https://linkapsychickepomoci.cz/
