"""Read a Bedrock .mcstructure: uncompressed, little-endian NBT.

Not a zip, despite the name — the whole file is one TAG_Compound written
little-endian, which is why every generic NBT tool refuses it.
"""
import struct
import sys
import json

END, BYTE, SHORT, INT, LONG, FLOAT, DOUBLE, BYTE_ARRAY, STRING, LIST, COMPOUND, INT_ARRAY, LONG_ARRAY = range(13)


class Reader:
    def __init__(self, data):
        self.d = data
        self.i = 0

    def take(self, n):
        out = self.d[self.i:self.i + n]
        if len(out) != n:
            raise EOFError(f"wanted {n} bytes at {self.i}, file has {len(self.d) - self.i}")
        self.i += n
        return out

    def u(self, fmt):
        size = struct.calcsize(fmt)
        return struct.unpack("<" + fmt, self.take(size))[0]

    def string(self):
        n = self.u("H")
        return self.take(n).decode("utf-8", "replace")

    def payload(self, kind):
        if kind == BYTE:       return self.u("b")
        if kind == SHORT:      return self.u("h")
        if kind == INT:        return self.u("i")
        if kind == LONG:       return self.u("q")
        if kind == FLOAT:      return self.u("f")
        if kind == DOUBLE:     return self.u("d")
        if kind == BYTE_ARRAY: return list(self.take(self.u("i")))
        if kind == STRING:     return self.string()
        if kind == LIST:
            item = self.u("b")
            n = self.u("i")
            return [self.payload(item) for _ in range(n)] if n > 0 else []
        if kind == COMPOUND:
            out = {}
            while True:
                t = self.u("b")
                if t == END:
                    return out
                name = self.string()
                out[name] = self.payload(t)
        if kind == INT_ARRAY:  return [self.u("i") for _ in range(self.u("i"))]
        if kind == LONG_ARRAY: return [self.u("q") for _ in range(self.u("i"))]
        raise ValueError(f"unknown tag {kind} at {self.i}")

    def root(self):
        t = self.u("b")
        if t != COMPOUND:
            raise ValueError(f"expected a compound root, got tag {t}")
        self.string()          # root name, conventionally empty
        return self.payload(COMPOUND)


def load(path):
    with open(path, "rb") as fh:
        return Reader(fh.read()).root()


if __name__ == "__main__":
    tree = load(sys.argv[1])
    print(json.dumps(tree, indent=1, default=str)[:4000])
