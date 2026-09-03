# releases/

Finished `.mcaddon` files, one per version, ready to upload.

This is the drawer you open when a storefront asks for a file. `Admin+.mcaddon`
in the project root is the *current* build and gets overwritten every time
`mcpack.py` runs — so it is never the right thing to hand to CurseForge, because
by the time the upload form is open it may already be a different build than the
one you tested.

```
python tools/archive.py
```

copies the current build in here, named with the version out of the manifest.
Run it after a build you are happy with.

## MCPEDL.png

Not a release. It is the ownership handshake for MCPEDL's CurseForge import:
MCPEDL will only mirror a project that has an image **titled** `MCPEDL` on it,
because only someone with write access to the project could have put it there.

That same image is what MCPEDL shows as the listing thumbnail, so it is doing
two jobs and the second one matters more: in a grid of cards next to VEIN ALL
BLOCKS and POTIONS REIMAGINED, a dark logo on a dark card says nothing at all.
`python tools/thumbnail.py` builds it — wordmark, one-line pitch, and the hook
that separates this from every other essentials pack.

The filename matters only because CurseForge pre-fills an image's title from it.
The thing being checked is the TITLE field, which has to read exactly `MCPEDL`.

## The files themselves are not committed

Only this README is. A `.mcaddon` is a half-megabyte zip that changes completely
on every build, and git keeps every version of it forever — a year of releases
would be a repository nobody wants to clone. The public copies live on the
GitHub releases page, which is built for exactly this.

So: this folder is local. If you move machines, the releases page has them all.
