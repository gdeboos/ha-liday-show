"""Turns a request in words into clips ("red and green chase on the roof in the chorus"), into
effect presets ("slow icy shimmer") or into colour palettes ("frosty winter night"), and writes notes
on a song's sections.

Two ways to reach a model: Claude directly, when the add-on's Configuration has a Claude API key,
or else Home Assistant's AI Task action, which uses whichever AI integration the user has set up
there (Anthropic, OpenAI, Google, a local Ollama...). The editor sends the request with the show's
context, and checks and places the clips that come back.
"""
import json
import logging
import os
import re
from pathlib import Path

from .ha import HAError, HomeAssistant

log = logging.getLogger(__name__)

CLAUDE_MODEL = "claude-opus-5-5"
OPTIONS = Path(os.environ.get("HALIDAY_SHOW_OPTIONS", "/data/options.json"))
MAX_REQUEST = 2000  # characters the user can type
MAX_CONTEXT = 200_000  # bytes of show context


class AIError(Exception):
    pass


def options() -> dict:
    """The add-on's Configuration tab settings (the Supervisor writes them to /data/options.json)."""
    try:
        return json.loads(OPTIONS.read_text())
    except (OSError, ValueError):
        return {}


def claude_key() -> str:
    return str(options().get("claude_api_key") or os.environ.get("ANTHROPIC_API_KEY") or "").strip()


INSTRUCTIONS = """You design light shows for Govee LED lights. Each light is a strip of segments that the \
show colours frame by frame. A show is a list of clips: one effect, with its settings, on one light from a \
start time to an end time in seconds. Clips you add replace what that light had in that stretch of time.

Turn the user's request into clips, using the context below:
- "lights": each light's name and segment count. "House" is a special lane whose effects (the ones marked \
"house") run across every light by where it sits on the house photo; use it only if it is listed, and only \
with house effects. Other lights take only the other effects. A light marked "slow" can only change a few \
times a second: give it effects that change the whole light at once or barely move (fades, colour cycles, \
pulses, still blocks, slow gradients), at most once a beat, and never fast chases, comets, scanners, \
marquees, twinkles, strobes, flicker or rainbows.
- "effects": every effect, with its settings (key, type, range or options, and default). Leave out settings \
the default suits. Colours are "#rrggbb"; LEDs wash out pastels and dark shades, so use strong colours, and \
"#000000" for off.
- "song": its length, tempo, beat and bar times, and sections (Intro, Verse, Chorus...) with their energy \
from 0 (quiet) to 1 (loud). Start and end clips on bar or beat times so changes land with the music, and \
set speeds from the tempo (for example one step or flash per beat). A section's "notes" are the user's own \
words about that part of the song (what happens in the music, or how they want it lit): follow them.
- "selection": the stretch of time and lights the user has selected, if any. When the request doesn't say \
where or when, use the selection, else the whole song.
- "palettes": named colour sets, for requests like "in Christmas colours".
- "clips": what the lights have now, for requests that refer to it.

When asked for a complete new show (the lights are cleared first, so a light with no clip is dark), design \
it as a person would rather than lighting everything all the time: quiet parts use fewer lights, lights come \
in as the music builds, and every light together is saved for the biggest moments, unless the request says \
otherwise. For anything smaller (a selection, named lights, a change to what's there), do just what's asked \
on the lights it's about.

Use only light names and effect keys from the context. Keep clips within the song. Give a one-sentence \
summary of what you made, in plain words. If the request can't be done with these lights and effects, \
return no clips and say why in the summary."""

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "clips": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "light": {"type": "string"},
                    "start": {"type": "number"},
                    "end": {"type": "number"},
                    "effect": {"type": "string"},
                    "settings": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {"key": {"type": "string"}, "value": {"type": "string"}},
                            "required": ["key", "value"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["light", "start", "end", "effect", "settings"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "clips"],
    "additionalProperties": False,
}


PRESET_INSTRUCTIONS = """You design effect presets for Govee LED lights. A preset is a named set of settings for one \
effect, which the user can then put on any light or stretch of a show. Turn the user's description into up to \
three presets, each a different take on it (for example a slower and a faster one, or different effects).

Use the context below:
- "effects": every effect, with its settings (key, type, range or options, and default). Effects marked \
"house" run across every light by where it sits on the house photo; use them only if the description is about \
the whole house. Set every setting that matters to the look; leave out ones the default suits. Colours are \
"#rrggbb"; LEDs wash out pastels and dark shades, so use strong colours, and "#000000" for off. Speeds are per \
second.
- "palettes": named colour sets, for descriptions like "in Christmas colours".

Use only effect keys and setting keys from the context. Give each preset a short name of two to four words \
that says what it looks like, such as "Icy shimmer" or "Slow fire flicker". Give a one-sentence summary of \
what you made, in plain words. If the description can't be done with these effects, return no presets and \
say why in the summary."""

PRESET_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "presets": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "effect": {"type": "string"},
                    "settings": SCHEMA["properties"]["clips"]["items"]["properties"]["settings"],
                },
                "required": ["name", "effect", "settings"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "presets"],
    "additionalProperties": False,
}


PALETTE_INSTRUCTIONS = """You design colour palettes for Govee LED lights. A palette is a named set of two to \
twelve colours that the user drops into effects to colour a show. Turn the user's description into up to three \
palettes, each a different take on it (for example a bolder and a softer one, or fewer and more colours).

Colours are "#rrggbb". LEDs wash out pastels and dark shades and can't show black, grey or brown, so use strong, \
saturated colours and white; a hint of a pale colour is fine, but not several. Put the colours in a sensible \
order, as effects step through them in turn. Most palettes suit three to six colours.

"palettes" in the context are the ones that already exist; don't repeat one of them. Give each palette a short \
name of one to three words that says what it is, such as "Frosty night" or "Tropical sunset". Give a one-sentence \
summary of what you made, in plain words."""

PALETTE_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "palettes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "colors": {"type": "array", "items": {"type": "string"}},
                },
                "required": ["name", "colors"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "palettes"],
    "additionalProperties": False,
}


SECTION_INSTRUCTIONS = """You write notes on the sections of a song, for someone designing a Christmas or Halloween \
light show to it on their house. Each note says, in a sentence or two, what that part of the song is like and how \
to light it, in plain words, such as "Quiet music-box intro, bells only; keep it gentle, a soft glow on a few \
lights" or "Biggest part of the song, drums on every beat, big crash at 1:12; everything on, flashing on the beat, \
all white on the crash".

You can't hear the song. Use the context below:
- "song": its name (often its title and artist) and length. If you know the song, use what you know of it: which \
part is the verse, chorus, bridge or solo, which instruments come in, where it builds. If you don't, go by the \
measurements only, and don't guess at lyrics or instruments.
- "sections": each section in order, with its start and end in seconds, its current name and what was measured: \
"loudness" from 0 (the quietest section) to 1 (the loudest), "shape" (builds, fades or steady), "busy" (busy, \
sparse or steady, against the rest of the song), "tone" (bass, bright or even), and the times of any "big_hits" \
and moments it "goes_quiet". Mention those times as m:ss.
- Write notes only for sections marked "write": true, under 300 characters each. Sections with "your_notes" were \
written by the person; leave them, but you can use them to understand the song.
- For sections marked "rename": true, also give a better name if you can tell what it is (Intro, Verse, Chorus, \
Pre-chorus, Bridge, Solo, Drop, Build-up, Outro...), at most 40 characters. Give sections that sound alike the \
same name. Leave "name" empty to keep the current one.

Return every section you wrote for by its "index". Give a one-sentence summary of what you did."""

CUT_INSTRUCTIONS = """You help someone shorten a song for a Christmas or Halloween light show on their house. The \
editor has already found a few ways to cut it, each taking out whole bars where the music either side of the join \
matches. Your job is to say which works best musically, and why, in a short phrase each.

You can't hear the song. Use the context below:
- "song": its name (often its title and artist), length and tempo. If you know the song, use what you know of it: \
which part is the verse, chorus, bridge or solo, and which moments people wait for. Don't guess at lyrics.
- "shorten": what's being shortened (the whole song or one section), how long it is now and how long they'd like it.
- "sections": the song's sections in order, with start and end in seconds, names, and any notes (some written by the \
person: take those seriously, as they say what matters to them).
- "marks": moments the person flagged by name, such as a big hit. Cutting one out is usually a bad idea.
- "options": each a list of cuts (from and to, in seconds, how many bars, and how well the join matches), how much \
shorter it makes things and the length after.

Prefer options that take out repeated material (a second verse, a repeat of a chorus, a long intro loop) over \
unique moments; keep marked moments, the song's best-known parts and its ending; keep the sections' shape (an \
intro still sounds like an intro); and favour smoother joins and lengths closest to what was asked.

Return every option by its "index", best first, each with a reason under 120 characters in plain words (times as \
m:ss), such as "Drops the repeated second verse; keeps the 1:12 crash". Give a one-sentence summary of what \
your pick does, without option numbers or indexes (the editor says which option it is)."""

CUT_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "choices": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"index": {"type": "integer"}, "reason": {"type": "string"}},
                "required": ["index", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "choices"],
    "additionalProperties": False,
}

SECTION_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {"index": {"type": "integer"}, "name": {"type": "string"}, "notes": {"type": "string"}},
                "required": ["index", "name", "notes"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "sections"],
    "additionalProperties": False,
}


def prompt(request: str, context: dict) -> str:
    return f"Context:\n{json.dumps(context, separators=(',', ':'))}\n\nRequest: {request}"


def parse_reply(text: str, field: str = "clips") -> dict:
    """The JSON object in a model's reply, which may be wrapped in a code block or prose."""
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        raise AIError(f"the AI didn't return any {field}")
    try:
        data = json.loads(m.group(0))
    except ValueError as e:
        raise AIError(f"the AI's reply wasn't valid JSON: {e}") from e
    if not isinstance(data, dict) or not isinstance(data.get(field, []), list):
        raise AIError("the AI's reply wasn't in the expected shape")
    return {"summary": str(data.get("summary") or ""), field: data.get(field) or []}


async def ask_claude(key: str, text: str, instructions: str = INSTRUCTIONS, schema: dict = SCHEMA,
                     field: str = "clips") -> dict:
    import anthropic  # imported here so the add-on starts even if the package is missing

    client = anthropic.AsyncAnthropic(api_key=key, timeout=120, max_retries=2)
    try:
        response = await client.beta.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=16000,
            system=instructions,
            messages=[{"role": "user", "content": text}],
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            # If Claude declines, the API retries on a fallback model in the same call.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.AuthenticationError as e:
        raise AIError("Claude didn't accept the API key; check it on the app's Configuration tab") from e
    except anthropic.RateLimitError as e:
        raise AIError("Claude is busy or the account is out of credit; try again shortly") from e
    except anthropic.APIStatusError as e:
        raise AIError(f"Claude returned an error ({e.status_code}): {e.message}") from e
    except anthropic.APIConnectionError as e:
        raise AIError("couldn't reach Claude; check the Home Assistant host's internet connection") from e
    finally:
        await client.close()
    if response.stop_reason == "refusal":
        raise AIError("Claude declined that request")
    if response.stop_reason == "max_tokens":
        raise AIError(f"that request needs too many {field} at once; try asking for less")
    return parse_reply(next((b.text for b in response.content if b.type == "text"), ""), field)


async def ask_home_assistant(ha: HomeAssistant, text: str, entity: str | None, instructions: str = INSTRUCTIONS,
                             schema: dict = SCHEMA, field: str = "clips") -> dict:
    data = {"task_name": f"Govee light show {field}",
            "instructions": f"{instructions}\n\nReply with only a JSON object matching this schema:\n"
                            f"{json.dumps(schema)}\n\n{text}"}
    if entity:
        data["entity_id"] = entity
    try:
        reply = await ha.call_with_response("ai_task", "generate_data", data, timeout=120)
    except HAError as e:
        raise AIError(f"Home Assistant's AI Task failed: {e}") from e
    result = (reply or {}).get("service_response") or {}
    data = result.get("data")
    return parse_reply(data if isinstance(data, str) else json.dumps(data), field)


async def status(ha: HomeAssistant) -> dict:
    """Which way requests will go: "claude", "ha" (with its AI Task entities) or None."""
    if claude_key():
        return {"via": "claude", "model": CLAUDE_MODEL}
    entities = []
    if ha.available:
        try:
            entities = [s["entity_id"] for s in await ha.states("ai_task")]
        except HAError:
            pass
    # The entity named in the Configuration, else the only one, else Home Assistant's preferred one.
    entity = str(options().get("ai_task_entity") or os.environ.get("HALIDAY_SHOW_AI_TASK_ENTITY") or "") or (entities[0] if len(entities) == 1 else None)
    return {"via": "ha" if entities else None, "entities": entities, "entity": entity}


async def _create(ha: HomeAssistant, request: str, context: dict, instructions: str, schema: dict,
                  field: str) -> dict:
    request = (request or "").strip()
    if not request:
        raise AIError("type what you'd like the lights to do")
    if len(request) > MAX_REQUEST:
        raise AIError("that request is too long")
    text = prompt(request, context)
    if len(text) > MAX_CONTEXT:
        raise AIError("this show is too big to describe to the AI in one go")
    key = claude_key()
    if key:
        return {**await ask_claude(key, text, instructions, schema, field), "via": "claude"}
    st = await status(ha)
    if not st["via"]:
        raise AIError("no AI is set up: add a Claude API key on the app's Configuration tab, "
                      "or set up an AI integration with an AI Task entity in Home Assistant")
    return {**await ask_home_assistant(ha, text, st["entity"], instructions, schema, field), "via": "ha"}


async def create_clips(ha: HomeAssistant, request: str, context: dict) -> dict:
    return await _create(ha, request, context, INSTRUCTIONS, SCHEMA, "clips")


async def create_presets(ha: HomeAssistant, request: str, context: dict) -> dict:
    return await _create(ha, request, context, PRESET_INSTRUCTIONS, PRESET_SCHEMA, "presets")


async def create_section_notes(ha: HomeAssistant, request: str, context: dict) -> dict:
    return await _create(ha, request, context, SECTION_INSTRUCTIONS, SECTION_SCHEMA, "sections")


async def rank_cuts(ha: HomeAssistant, request: str, context: dict) -> dict:
    return await _create(ha, request, context, CUT_INSTRUCTIONS, CUT_SCHEMA, "choices")


async def create_palettes(ha: HomeAssistant, request: str, context: dict) -> dict:
    return await _create(ha, request, context, PALETTE_INSTRUCTIONS, PALETTE_SCHEMA, "palettes")
