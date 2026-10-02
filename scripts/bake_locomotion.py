"""Bake neutral high-heel locomotion onto the supplied RE-style skeleton.

Requires numpy, scipy and Pillow. Preserves all meshes, the two existing skins
and material assignments. Clips use metres and stay in place; the controller
owns world translation. Foot targets are solved with two-bone IK.
"""
import argparse
import copy
import io
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.spatial.transform import Rotation as Rot

DTYPES = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}
WIDTH = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


class Rig:
    def __init__(self, document, binary):
        self.j, self.bin = document, binary
        self.nodes = document["nodes"]
        self.ids = {n.get("name"): i for i, n in enumerate(self.nodes)}
        self.parent = {c: i for i, n in enumerate(self.nodes) for c in n.get("children", [])}
        self.rest = [self.matrix(n) for n in self.nodes]
        self.local = [m.copy() for m in self.rest]
        self.world_rest = [self.world(i) for i in range(len(self.nodes))]
        self.rotated, self.translated = set(), set()
        self.soles = {}
        for side in ["l", "r"]:
            ankle = self.world_rest[self.id(f"{side}_leg_ankle")][:3, 3]
            shoe = self.accessor(document["meshes"][1]["primitives"][0]["attributes"]["POSITION"])
            sign = 1 if side == "l" else -1
            sole = shoe[(shoe[:, 0] * sign > 0.035) & (shoe[:, 1] < 0.048)]
            self.soles[side] = sole - ankle

    @staticmethod
    def matrix(node):
        if "matrix" in node:
            return np.array(node["matrix"]).reshape(4, 4).T.copy()
        m = np.eye(4)
        m[:3, :3] = Rot.from_quat(node.get("rotation", [0, 0, 0, 1])).as_matrix() @ np.diag(node.get("scale", [1, 1, 1]))
        m[:3, 3] = node.get("translation", [0, 0, 0])
        return m

    def accessor(self, i):
        a = self.j["accessors"][i]
        v = self.j["bufferViews"][a["bufferView"]]
        dt = np.dtype(DTYPES[a["componentType"]])
        return np.ndarray((a["count"], WIDTH[a["type"]]), dtype=dt, buffer=self.bin,
                          offset=v.get("byteOffset", 0) + a.get("byteOffset", 0),
                          strides=(v.get("byteStride", dt.itemsize * WIDTH[a["type"]]), dt.itemsize)).copy()

    def id(self, name):
        return self.ids["Body/" + name]

    def world(self, i):
        return self.world(self.parent[i]) @ self.local[i] if i in self.parent else self.local[i]

    def reset(self):
        self.local = [m.copy() for m in self.rest]

    def rotation(self, i, world_rotation):
        parent_rotation = self.world(self.parent[i])[:3, :3] if i in self.parent else np.eye(3)
        self.local[i][:3, :3] = parent_rotation.T @ world_rotation
        self.rotated.add(i)

    def delta(self, name, xyz):
        i = self.id(name)
        self.local[i][:3, :3] = self.rest[i][:3, :3] @ Rot.from_euler("xyz", xyz).as_matrix()
        self.rotated.add(i)

    @staticmethod
    def align(a, b):
        a, b = a / np.linalg.norm(a), b / np.linalg.norm(b)
        v = np.cross(a, b)
        d = np.clip(np.dot(a, b), -1, 1)
        if np.linalg.norm(v) < 1e-8:
            return np.eye(3)
        return Rot.from_rotvec(v / np.linalg.norm(v) * math.acos(d)).as_matrix()

    def aim(self, i, child, target):
        # Keep the imported bone roll while changing the world-space direction.
        base = self.world_rest[i][:3, :3]
        rest_direction = base @ self.rest[child][:3, 3]
        desired = target - self.world(i)[:3, 3]
        self.rotation(i, self.align(rest_direction, desired) @ base)

    def leg(self, side, target, pitch):
        thigh, shin, ankle = [self.id(f"{side}_leg_{s}") for s in ["femur", "tibia", "ankle"]]
        hip = self.world(thigh)[:3, 3]
        a, b = np.linalg.norm(self.rest[shin][:3, 3]), np.linalg.norm(self.rest[ankle][:3, 3])
        v = target - hip
        raw = np.linalg.norm(v)
        distance = min(raw, a + b - 0.0002)
        direction = v / raw
        advance = (a * a - b * b + distance * distance) / (2 * distance)
        height = math.sqrt(max(a * a - advance * advance, 0))
        pole = np.array([0., 0., 1.])
        pole -= direction * np.dot(pole, direction)
        pole /= np.linalg.norm(pole)
        knee = hip + direction * advance + pole * height
        self.aim(thigh, shin, knee)
        self.aim(shin, ankle, target)
        self.rotation(ankle, Rot.from_euler("x", pitch).as_matrix() @ self.world_rest[ankle][:3, :3])
        return max(raw - (a + b - 0.0002), 0)

    def arms(self, phase, run, moving):
        for side, sign, shift in [("l", 1, 0), ("r", -1, .5)]:
            shoulder, elbow, wrist = [self.id(f"{side}_arm_{s}") for s in ["humerus", "radius", "wrist"]]
            q = 2 * math.pi * (phase + shift)
            swing = -math.cos(q) * (0.58 if run else .30) * moving
            origin = self.world(shoulder)[:3, 3]
            upper_length = np.linalg.norm(self.rest[elbow][:3, 3])
            direction = np.array([sign * .32, -math.cos(swing), math.sin(swing)])
            direction /= np.linalg.norm(direction)
            elbow_target = origin + direction * upper_length
            self.aim(shoulder, elbow, elbow_target)
            forearm_length = np.linalg.norm(self.rest[wrist][:3, 3])
            bend = 1.22 if run else .28
            lower_dir = np.array([sign * .14, -math.cos(swing + bend), math.sin(swing + bend)])
            lower_dir /= np.linalg.norm(lower_dir)
            wrist_target = self.world(elbow)[:3, 3] + lower_dir * forearm_length
            self.aim(elbow, wrist, wrist_target)

    def pose(self, phase, kind):
        self.reset()
        run, moving = kind == "Run_Heels", kind != "Idle_Heels"
        cycle = 2 * math.pi * phase
        cog = self.id("COG")
        self.local[cog][:3, 3] += [0, (-.081 + .009 * math.cos(2 * cycle)) if moving and not run else (-.089 - .034 * math.cos(2 * cycle)) if run else -.025 + .002 * math.sin(cycle), 0]
        self.translated.add(cog)
        self.delta("hips", [0, .025 * math.sin(cycle) if moving else 0, .014 * math.sin(cycle) if moving else 0])
        self.delta("spine_0", [.10 if run else .020, -.022 * math.sin(cycle) if moving else 0, 0])
        self.delta("spine_1", [.012 if moving else .003 * math.sin(cycle), 0, 0])
        self.delta("spine_2", [0, -.027 * math.sin(cycle) if moving else 0, 0])
        self.delta("neck_0", [-.05 if run else -.012, 0, 0])
        self.delta("head", [-.025 if run else 0, 0, 0])
        max_error = 0
        for side, shift in [("l", 0), ("r", .5)]:
            p = (phase + shift) % 1
            ankle_i = self.id(f"{side}_leg_ankle")
            target = self.world_rest[ankle_i][:3, 3].copy()
            pitch, lift, z = 0., 0., 0.
            if moving:
                duty = .40 if run else .62
                speed, period = (2.4, .66) if run else (.95, 1.08)
                travel = speed * period * duty
                if p < duty:
                    q = p / duty
                    z = travel * (.5 - q)
                    # Heel lift in late stance, with the shoe sole as pivot.
                    pitch = math.radians(13 if run else 11) * max(0., (q - .67) / .33) ** 2
                else:
                    q = (p - duty) / (1 - duty)
                    ease = 3 * q * q - 2 * q * q * q
                    z = travel * (ease - .5)
                    lift = (.155 if run else .085) * math.sin(math.pi * q) ** 1.35
                    pitch = math.radians(13 if run else 11) * (1 - q) ** 2 - math.radians(7) * math.sin(math.pi * q)
            rotation = Rot.from_euler("x", pitch).as_matrix()
            sole = self.soles[side] @ rotation.T
            pivot_y = -sole[:, 1].min()
            # Compensate toe-off rotation so the low sole point stays on the plane.
            pivot = self.soles[side][np.argmin(sole[:, 1])]
            target[1] = pivot_y + lift + .0006
            target[2] += z - ((rotation @ pivot)[2] - pivot[2])
            max_error = max(max_error, self.leg(side, target, pitch))
        self.arms(phase, run, float(moving))
        # The head/hair use a separate imported skin. Bake the corresponding
        # body world transforms into that skin, preserving each bind offset.
        for i, n in enumerate(self.nodes):
            name = n.get("name", "")
            if not name.startswith("Head/"):
                continue
            body_i = self.ids.get("Body/" + name[5:])
            if body_i is None:
                continue
            if body_i not in self.rotated and name != "Head/spine_2":
                continue
            desired = self.world(body_i) @ np.linalg.inv(self.world_rest[body_i]) @ self.world_rest[i]
            parent_world = self.world(self.parent[i]) if i in self.parent else np.eye(4)
            self.local[i] = np.linalg.inv(parent_world) @ desired
            self.rotated.add(i)
            if name == "Head/spine_2":
                self.translated.add(i)
        return max_error


def bake(source, output, diagnostics):
    data = Path(source).read_bytes()
    json_size = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + json_size])
    original_binary = data[28 + json_size:]
    rig = Rig(copy.deepcopy(doc), original_binary)
    # New tightly packed buffer: remove abandoned texture bytes and unused
    # secondary influences; preserve every active geometry accessor.
    new_bin = bytearray()
    old_views = copy.deepcopy(doc["bufferViews"])
    doc["bufferViews"] = []

    def append_view(bytes_, target=None):
        while len(new_bin) % 4:
            new_bin.append(0)
        i, off = len(doc["bufferViews"]), len(new_bin)
        new_bin.extend(bytes_)
        view = {"buffer": 0, "byteOffset": off, "byteLength": len(bytes_)}
        if target:
            view["target"] = target
        doc["bufferViews"].append(view)
        return i

    image_views = {im["bufferView"] for im in doc["images"]}
    remap = {}
    for i, view in enumerate(old_views):
        if i in image_views:
            continue
        chunk = original_binary[view.get("byteOffset", 0):view.get("byteOffset", 0) + view["byteLength"]]
        remap[i] = append_view(chunk, view.get("target"))
        if "byteStride" in view:
            doc["bufferViews"][remap[i]]["byteStride"] = view["byteStride"]
    for accessor in doc["accessors"]:
        if "bufferView" in accessor:
            accessor["bufferView"] = remap[accessor["bufferView"]]

    sizes = []
    for image in doc["images"]:
        v = old_views[image["bufferView"]]
        im = Image.open(io.BytesIO(original_binary[v.get("byteOffset", 0):v.get("byteOffset", 0) + v["byteLength"]]))
        name = image.get("name", "")
        packed = "OcclusionRoughnessMetallic" in name or "Normal" in name
        limit = 1024 if packed else 2048
        im.thumbnail((limit, limit), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        if im.mode == "RGBA" or packed:
            im.save(out, "PNG", optimize=True)
            image["mimeType"] = "image/png"
        else:
            im.convert("RGB").save(out, "JPEG", quality=92, subsampling=0, optimize=True)
            image["mimeType"] = "image/jpeg"
        raw = out.getvalue()
        image["bufferView"] = append_view(raw)
        sizes.append({"name": name, "size": list(im.size), "bytes": len(raw)})

    def append_accessor(array, kind, component=5126, target=None):
        arr = np.asarray(array, dtype=DTYPES[component])
        view = append_view(arr.tobytes(), target)
        a = {"bufferView": view, "componentType": component, "count": len(arr), "type": kind}
        if kind == "SCALAR":
            a.update(min=[float(arr.min())], max=[float(arr.max())])
        doc["accessors"].append(a)
        return len(doc["accessors"]) - 1

    # Three.js supports four skin influences. Select the strongest across both
    # imported sets, then normalize, instead of silently discarding JOINTS_1.
    weight_stats = []
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            attrs = prim["attributes"]
            if "JOINTS_1" not in attrs:
                continue
            ids = np.concatenate([rig.accessor(attrs["JOINTS_0"]), rig.accessor(attrs["JOINTS_1"])], axis=1)
            wei = np.concatenate([rig.accessor(attrs["WEIGHTS_0"]), rig.accessor(attrs["WEIGHTS_1"])], axis=1)
            strongest = np.argsort(-wei, axis=1, kind="stable")[:, :4]
            keep = np.take_along_axis(wei, strongest, axis=1)
            weight_stats.append({"mesh": mesh.get("name"), "maximum_discarded_weight": float((wei.sum(1) - keep.sum(1)).max())})
            keep /= np.maximum(keep.sum(1, keepdims=True), 1e-8)
            attrs["JOINTS_0"] = append_accessor(np.take_along_axis(ids, strongest, axis=1), "VEC4", 5123, 34962)
            attrs["WEIGHTS_0"] = append_accessor(keep, "VEC4", 5126, 34962)
            del attrs["JOINTS_1"], attrs["WEIGHTS_1"]

    doc["animations"] = []
    clip_stats = []
    for name, period, frame_count in [("Idle_Heels", 3.6, 108), ("Walk_Heels", 1.08, 64), ("Run_Heels", .66, 64)]:
        frames, errors = [], []
        for f in range(frame_count + 1):
            errors.append(rig.pose(f / frame_count, name))
            frames.append([m.copy() for m in rig.local])
        time_id = append_accessor(np.linspace(0, period, frame_count + 1), "SCALAR")
        anim = {"name": name, "samplers": [], "channels": [], "extras": {"inPlace": True, "loop": True, "referenceSpeed": {"Walk_Heels": .95, "Run_Heels": 2.4}.get(name, 0), "footwear": "high-heels", "generator": "Two-bone foot IK, preserved shoe bind pose"}}
        for node_id, path in [(i, "rotation") for i in sorted(rig.rotated)] + [(i, "translation") for i in sorted(rig.translated)]:
            if path == "rotation":
                arr = Rot.from_matrix(np.array([f[node_id][:3, :3] for f in frames])).as_quat()
                for k in range(1, len(arr)):
                    if np.dot(arr[k], arr[k-1]) < 0:
                        arr[k] *= -1
                kind = "VEC4"
            else:
                arr = np.array([f[node_id][:3, 3] for f in frames])
                kind = "VEC3"
            # Exact first/last equality prevents visible loop seams.
            arr[-1] = arr[0]
            sampler_id = len(anim["samplers"])
            anim["samplers"].append({"input": time_id, "output": append_accessor(arr, kind), "interpolation": "LINEAR"})
            anim["channels"].append({"sampler": sampler_id, "target": {"node": node_id, "path": path}})
            n = doc["nodes"][node_id]
            if "matrix" in n:
                mat = rig.rest[node_id]
                n.pop("matrix")
                n["translation"] = mat[:3, 3].tolist()
                n["rotation"] = Rot.from_matrix(mat[:3, :3]).as_quat().tolist()
                n["scale"] = [1, 1, 1]
        doc["animations"].append(anim)
        clip_stats.append({"name": name, "duration": period, "frames": frame_count + 1, "channels": len(anim["channels"]), "max_ik_reach_error_m": max(errors)})

    doc["asset"]["generator"] = "High-heel locomotion bake; original user model preserved"
    doc.setdefault("extras", {})["locomotion"] = {"units": "metres", "forward": "+Z", "walkSpeed": .95, "runSpeed": 2.4, "inPlace": True}
    doc["buffers"] = [{"byteLength": len(new_bin)}]
    while len(new_bin) % 4:
        new_bin.append(0)
    json_bytes = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(new_bin)
    result = struct.pack("<III", 0x46546c67, 2, total) + struct.pack("<II", len(json_bytes), 0x4e4f534a) + json_bytes + struct.pack("<II", len(new_bin), 0x004e4942) + new_bin
    Path(output).parent.mkdir(parents=True, exist_ok=True)
    Path(output).write_bytes(result)
    report = {"source_bytes": len(data), "output_bytes": len(result), "clips": clip_stats, "images": sizes, "weights": weight_stats}
    Path(diagnostics).write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({k: report[k] for k in ["source_bytes", "output_bytes", "clips"]}, indent=2))


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("source")
    p.add_argument("output")
    p.add_argument("--diagnostics", default="animation-bake.json")
    args = p.parse_args()
    bake(args.source, args.output, args.diagnostics)
