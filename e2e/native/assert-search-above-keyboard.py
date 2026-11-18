"""Check Maestro's iOS hierarchy; accessibility visibility alone misses keyboard occlusion.

Usage: python3 e2e/native/assert-search-above-keyboard.py hierarchy.json
Capture with `maestro hierarchy` while the software keyboard is open.
"""
import json
import re
import sys


def nodes(node):
    yield node.get("attributes", {})
    for child in node.get("children", []):
        yield from nodes(child)


def label(node):
    return node.get("accessibilityText") or node.get("text") or node.get("value", "")


def bounds(node):
    return tuple(map(int, re.findall(r"-?\d+", node["bounds"])))


def keyboard_frames(node):
    # The lowest container holding both alphabet keys and the bottom keyboard
    # switch is the real keyboard frame, including its rounded top padding.
    descendant_labels = {label(n) for n in nodes(node)}
    if descendant_labels.intersection({"q", "Q"}) and "Next keyboard" in descendant_labels:
        attrs = node.get("attributes", {})
        if bounds(attrs)[1] > 0:
            yield bounds(attrs)
        for child in node.get("children", []):
            yield from keyboard_frames(child)


with open(sys.argv[1], encoding="utf-8") as source:
    hierarchy = json.load(source)
elements = list(nodes(hierarchy))
frames = list(keyboard_frames(hierarchy))
assert frames, "Software keyboard must be open (English keyboard required)"
keyboard_top = min(frames, key=lambda frame: frame[3] - frame[1])[1]

for name in ("Product finder sheet", "Select product Whole Milk 1L, Aisle 7, left, middle shelf", "Add Whole Milk 1L to shopping list"):
    matches = [n for n in elements if label(n) == name]
    assert matches, f"Missing {name}"
    x1, y1, x2, y2 = bounds(matches[0])
    print(f"{name}: y={y1}..{y2}; keyboard starts at {keyboard_top}")
    assert y1 >= 0 and y2 <= keyboard_top, f"{name} is covered by the keyboard"

print("PASS: results and actions stay above the open keyboard")
