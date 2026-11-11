<!-- The user guide is written here, a page per topic. tools/check_guide.py checks its links. -->

# Visitors' queue and voting

First come, first served, or a vote for what's next.

## Visitors' queue

What visitors get:

- **A card at the top** of the page says what's on, with a bar showing how far through it is, and
  **Listen** if listening is on. It stays in view as they scroll down the shows.
- **Up next** under it lists everyone's waiting picks, with each show's cover art and name (never who
  picked them) and roughly when each starts. The first three show, plus their own wherever it is, and **Show all**
  opens the rest.
- **If nothing's on**, each show has **Start** and their pick starts straight away. While something's
  on (or others are waiting) the button says **Queue** instead.
- **If something's on**, the card at the top tells them where they are in the queue and roughly how long
  it'll be, such as "You're next, starting in about 2 minutes". Their picks are highlighted in **Up next**,
  with **Cancel** beside each.
- **During one of your playlists**, a visitor's pick plays after the show that's on (and any pause after
  it), then your playlist carries on with its next show. A building block (a scene, colour, effect or Off)
  doesn't hold a pick back: the pick plays straight away and the playlist carries on after. While a block
  is on, the page shows your playlist's name, with no **Listen** button since there's no song. The button
  still says **Start**, as it does over a scene. A scheduled playlist that's due to start waits until a
  visitor's show has finished.
- **A playlist** a visitor picks plays its shows through once, not round and round, without its
  building blocks.
- **The music** plays on the show's **Show speaker** (or your default one), as it does for playlists.
  A show with no speaker plays its lights only, unless the
  [Show player](playing.md#music-with-no-speaker-the-show-player) is open.
- **No repeats:** a show (or playlist) that's already waiting in the queue, or playing now, can't be
  picked again until it's played. Its button says **Queued** or **On now** instead. This applies to
  your own phone with the [Admin PIN](public-page.md#admin-pin) too.
- Visitors can't stop or skip anyone else's show.

## Voting for what's next

**How visitors pick**, at the top of the **Limits** page, is **Queue** (first come, first served, as
above) or **Vote**. With **Vote**:

- While a show plays, visitors see **Vote for what's next**, with a **Vote** button on each show and its
  votes so far. The one ahead says **Winning**.
- Each phone has one vote per round. Pressing another show moves it; pressing **Your vote** takes it back.
- When the show ends, the one with the most votes plays next, and a new round starts. A tie goes to the
  show that reached that number of votes first.
- With nothing on, the first vote plays straight away, and the voting is for the one after.
- When a show ends and nobody has voted, the lights rest until someone does.
- **Same song again after**, opening hours (and finishing before closing time), **Nearby only** and rest
  breaks work as they do for the queue. **Requests per phone**, **Queue length** and **Same phone again
  after** don't apply, so they're hidden.
- Your phone with the [Admin PIN](public-page.md#admin-pin) still picks a show outright: it plays next, ahead of the votes.
- The **Queue** page shows the votes so far. The words visitors read for voting are under **Words → Voting**.

Keeping it fair, on the **Limits** page (with **Queue**; with **Vote**, only **Same song again after**):

- **Requests per phone** is how many shows one phone can have waiting (1 to start with). Once a
  visitor's show starts, they can pick another. It's a courtesy limit that someone determined could
  get round; **Queue length** is the one that holds.
- **Queue length** is how many shows can wait in all (5 to start with). When it's full, visitors are
  asked to try again in a few minutes.
- **Same song again after** (15 minutes to start with): once a song has played, nobody can pick that
  song again for this long. Any other song is fine. It stops one favourite playing on a loop. Its button says
  **Again in 12 minutes** (say) until then. Your admin phone isn't held to it. 0 turns it off.
- **Same phone again after** (5 minutes to start with): once someone's song has played, their phone
  waits this long before picking another. Other phones aren't affected. It stops one person keeping the
  lights to themselves on a quiet night. Your admin phone doesn't wait. 0 turns it off.

**Tonight**, under the queue on the **Queue** page, counts visitors' picks since midday, lists the most
picked, and says how many phones are listening right now. It starts afresh when HA-liday Show restarts
(an update, say).

You stay in charge. Playing a show from the editor or an automation goes on straight away, and the
visitors' queue carries on afterwards. **■ Stop** (or stopping the song on the speaker) stops
everything and empties the queue, and so does **Clear the queue**. Turning off **Let visitors start
shows** empties the queue too, and visitors see "No shows right now".

<!-- nav: made by tools/check_guide.py -->

---

← [The public page](public-page.md) · [Contents](README.md) · [Visitors' phones](visitors-phones.md) →
<!-- /nav -->
