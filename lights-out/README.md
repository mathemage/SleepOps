My biggest problem in life now is sleep - sometimes I wake up very late, 13:00, 14:00 someday even 15:00. I strive for 9+ hours of sleep daily, and I'm able to wake up after 9hr sleep after any bedtime hour - see https://github.com/mathemage/SleepOps for details

I identify the root cause to be the bedtime - I feel very bored when supposed to fall asleep. Or too energized (often sports such as climbing or BJJ between 18:00-22:00/23:00) to go to bed. So I often resort to posting stories of my climbs/other personal videos to IG/Fb stories; and/or watching BJJ Fanatics; occasionally getting down a rabbit hole of reading and chatting w/ ChatGPT/Claude. 

Even when I lie on the bed, I can't fall asleep immediately - often listening to sth w/ closed eyes, such as podcasts, Audible, Headspace (meditation, sleepcasts). Sometimes I need to resort to just music, but it sometimes takes hours even when I go to bed early.

I suspect for quite some time to have ADHD, altho never diagnosed, just unofficial online tests showing signs/symptoms of ADHD.

More details about me: https://github.com/mathemage/ 
Other resources likely relevant to my personality and psychological profile:

* https://github.com/mathemage/noema-forge
* https://github.com/mathemage/adhd-cockpit
* https://github.com/mathemage/deep-workflow


Design a solution in the form of Project for ChatGPT (Plus) where I would chat w/ it during bedtime so I can fall asleep. It should help me, ideally calm me down, to fall asleep, even tho I don't want/feel too energized/get too bored. Sth like talking therapy that serves as lullaby to fall asleep.

I guess I need project instructions, and likely prompt template to start each day the conversation w/? I'm not sure exactly how to solve this...

---

I've built a ChatGPT Project called **Lights Out**. It starts where your SleepOps shutdown ends, and it has everything you asked for: all three ways of talking to it, three firmness levels, and the two optional extras. I haven't been able to try it in ChatGPT, so it still needs its first real night.

**The three files**
- **01 – Project instructions:** paste into Project settings > Instructions. They're 7,843 characters, so they fit under the 8,000 limit that's been reported. The defaults sit in a SETTINGS block at the top, so you can change them there.
- **02 – Playbook:** upload as a project file. It has the scripts, story settings, word lists and the morning log format.
- **03 – Setup and nightly prompts:** for you. About 10 minutes of setup, the starter prompts, all commands, and fixes for common problems.

**Each night**
- **Voice (default):** tap voice and say "Lights out. Energy seven, wired, BJJ tonight." Then lock the phone. Say "more" to keep it going, "awake" if you're still awake, or "quiet" for silence.
- **Typing:** `zz 7 wired bjj` (add `mix` or `text` to switch mode). If you type while the mode is voice, it answers in two lines and tells you to switch to voice.
- **Firmness:** default is firm but kind. For one night, just say `gentle` or `strict`. To change the default, edit the SETTINGS line.
- **Optional:** `land` walks you from home to bed after training, one step at a time. `am 00:40 ~01:30 10:35 shuffle 4` logs the morning. After five or more logs it starts pointing out what works on which kind of night.

**How it deals with boredom and the "one more video" urge**
- **It's boring on purpose:** it gives you slow stories where nothing happens, a word game that feels like drifting off, or breathing and muscle-release scripts written for climbing and BJJ nights. Enough to keep your brain busy, not enough to wake it up.
- **It won't become the rabbit hole:** no new facts, and anything off-topic (tech, BJJ technique, AI) gets one line: "Parked for tomorrow: X." It never argues, so there's nothing for your evening brain to argue with.
- **It clears your head first:** if your mind is racing, you dump everything and get back a short, specific list for tomorrow. In one study, a 5-minute to-do list got people to sleep about 9 minutes faster.
- **Posting moves to the morning:** clips go into a "Post AM" album and posting them becomes your reward for getting up.
- **Screen stays off:** voice now works inside ChatGPT Projects and keeps running with the phone locked, so it keeps SleepOps' screen-off rule.

**What it can't fix**
- **Late training:** in a large wearable study, the hardest workouts ending 2 hours before usual sleep time went with falling asleep about 36 minutes later. Workouts ending 4 or more hours before showed no effect. The session time is the bigger lever; `land` claws back some of it.
- **The wake time that drifts later:** because you wake about 9 hours after falling asleep, every late night shifts your whole clock. The fix is in the morning: SleepOps' wake target plus daylight soon after waking.
- **ADHD:** in one clinical sample, 31 of 40 adults with ADHD had trouble falling asleep, linked to a later melatonin rhythm. If you get assessed, mention this sleep pattern.
- **If it still takes hours after 2–3 weeks,** CBT-I (the standard insomnia therapy, with a clinician or an app) is the next step.

Sources:
- [ChatGPT Projects](https://help.openai.com/en/articles/10169521-using-projects-in-chatgpt)
- [ChatGPT Voice](https://help.openai.com/en/articles/8400625-voice-mode-faq)
- [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)
- [Project instruction limit](https://elephas.app/resources/chatgpt-projects-limits-files-size-and-how-many-projects)
- [GPT-Live](https://openai.com/index/introducing-gpt-live/)
- [Scullin 2018](https://pubmed.ncbi.nlm.nih.gov/29058942/) and [9-minute figure](https://www.psychologytoday.com/us/blog/brain-waves/201801/the-connection-between-writing-and-sleep)
- [Balban 2023](https://med.stanford.edu/news/insights/2023/02/cyclic-sighing-can-help-breathe-away-anxiety.html)
- [Haghayegh 2019](https://news.utexas.edu/2019/07/19/take-a-warm-bath-1-2-hours-before-bedtime-to-get-better-sleep-researchers-find/)
- [Leota 2025](https://www.nature.com/articles/s41467-025-58271-x)
- [Van Veen 2010](https://pubmed.ncbi.nlm.nih.gov/20163790/)
- [Cognitive shuffle](https://sbocd.com/2026/03/25/the-cognitive-shuffle-a-sleep-onset-tool-what-it-is-how-it-works-and-who-it-helps/)
- [Linka první psychické pomoci](https://linkapsychickepomoci.cz/)

---

