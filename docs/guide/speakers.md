<!-- Made by tools/split_guide.py from haliday_show/DOCS.md. Edit DOCS.md, then run the tool. -->

# Speakers

[← Your lights](lights.md) · [Contents](README.md) · [Your house →](house.md)

## 2. Speakers

The song can play on any Home Assistant media player that can play files from the media folder.
Speakers are added on the **Speakers** tab first, and only those are offered in the editor.

- Press **+ Add a speaker**, then **Test and add** next to a media player in the window that opens
  (type in **Find a speaker** to narrow a long list). HA-liday Show plays a short chime on it the same way
  a show starts and only adds it if that works. Media players that can't be sent a song are listed
  but can't be added, and a failed test shows Home Assistant's reason. Echo devices through Alexa
  Media Player and Emby clients, for example, often can't play files from the media folder.
- **Delay ms** is how late the speaker really starts after it reports playing. Raise it if the
  lights run ahead of the music (often 100 to 500 ms for Wi-Fi speakers).
- **Default show speaker** is where shows play when started from an automation, unless a show picks
  its own (see [Play it](play-it.md#5-play-it)).

---

[← Your lights](lights.md) · [Contents](README.md) · [Your house →](house.md)
