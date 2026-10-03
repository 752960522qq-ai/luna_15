"""Check baked clips with actual skinned shoe vertices and render QA poses."""
import json
import struct
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from scipy.spatial.transform import Rotation as Rot

from bake_locomotion import Rig

source, destination = Path(sys.argv[1]), Path(sys.argv[2])
destination.mkdir(parents=True, exist_ok=True)
data = source.read_bytes()
js = struct.unpack_from("<I", data, 12)[0]
doc = json.loads(data[20:20 + js])
rig = Rig(doc, data[28 + js:])
shoe_prim = doc["meshes"][1]["primitives"][0]
attr = shoe_prim["attributes"]
shoe_pos = rig.accessor(attr["POSITION"])
shoe_ids = rig.accessor(attr["JOINTS_0"]).astype(int)
shoe_weights = rig.accessor(attr["WEIGHTS_0"])
skin = doc["skins"][0]
ibm = rig.accessor(skin["inverseBindMatrices"]).reshape(-1, 4, 4).transpose(0, 2, 1)
sole_ids = np.where(shoe_pos[:, 1] < .048)[0]
rest_head_offset = np.linalg.inv(rig.world_rest[rig.id("spine_2")]) @ rig.world_rest[rig.ids["Head/spine_2"]]

def evaluate(anim, phase):
    rig.reset()
    for channel in anim["channels"]:
        sampler = anim["samplers"][channel["sampler"]]
        values = rig.accessor(sampler["output"])
        f = int(round(phase * (len(values) - 1)))
        target = channel["target"]
        if target["path"] == "rotation":
            rig.local[target["node"]][:3, :3] = Rot.from_quat(values[f]).as_matrix()
        elif target["path"] == "translation":
            rig.local[target["node"]][:3, 3] = values[f]
    cache = {}
    def world(i):
        if i not in cache:
            cache[i] = world(rig.parent[i]) @ rig.local[i] if i in rig.parent else rig.local[i]
        return cache[i]
    joints = np.array([world(k) for k in skin["joints"]]) @ ibm
    verts = np.c_[shoe_pos, np.ones(len(shoe_pos))]
    shoe = sum(np.einsum("nij,nj->ni", joints[shoe_ids[:, k]], verts) * shoe_weights[:, k, None] for k in range(4))[:, :3]
    expected = world(rig.id("spine_2")) @ rest_head_offset
    head_error = np.max(np.abs(world(rig.ids["Head/spine_2"]) - expected))
    return shoe, world, float(head_error)

report = {"clips": [], "shoe_penetration_minimum_m": 1, "head_sync_max_matrix_error": 0}
for anim in doc["animations"]:
    largest_loop_error = 0
    for s in anim["samplers"]:
        times, values = rig.accessor(s["input"]), rig.accessor(s["output"])
        assert np.isfinite(values).all()
        assert (np.diff(times[:, 0]) > 0).all()
        largest_loop_error = max(largest_loop_error, float(np.max(np.abs(values[0] - values[-1]))))
    assert largest_loop_error < 1e-6
    heights = {"l": [], "r": []}
    stance_values = []
    for phase in np.linspace(0, 1, 65):
        shoe, world, error = evaluate(anim, phase)
        report["head_sync_max_matrix_error"] = max(report["head_sync_max_matrix_error"], error)
        report["shoe_penetration_minimum_m"] = min(report["shoe_penetration_minimum_m"], float(shoe[:, 1].min()))
        for side, sign, shift in [("l", 1, 0), ("r", -1, .5)]:
            chosen = sole_ids[shoe_pos[sole_ids, 0] * sign > .035]
            minimum = float(shoe[chosen, 1].min())
            heights[side].append(minimum)
            contact_samples = anim.get("extras", {}).get("contactSamples")
            in_stance = contact_samples[int(round(phase*(len(contact_samples)-1)))][0 if side=="l" else 1] if contact_samples else (phase + shift)%1 < (.40 if anim["name"]=="Run_Heels" else .62)
            if anim["name"] == "Idle_Heels" or in_stance:
                stance_values.append(minimum)
    report["clips"].append({"name": anim["name"], "exact_loop": largest_loop_error == 0,
                           "left_shoe_clearance_m": [min(heights["l"]), max(heights["l"])],
                           "right_shoe_clearance_m": [min(heights["r"]), max(heights["r"])],
                           "stance_clearance_range_m": [min(stance_values), max(stance_values)]})

# Diagnostic projections keep focus on the motion skeleton and actual shoes.
fig, axes = plt.subplots(2, 6, figsize=(18, 8), facecolor="#101b27")
samples = [(0, 0), (1, 0), (1, .25), (2, 0), (2, .25), (3, .25)]
chains = [["COG", "spine_0", "spine_1", "spine_2", "neck_0", "neck_1", "head"]]
for side in ["l", "r"]:
    chains += [["hips", f"{side}_leg_femur", f"{side}_leg_tibia", f"{side}_leg_ankle", f"{side}_leg_ball"],
               ["spine_2", f"{side}_arm_clavicle", f"{side}_arm_humerus", f"{side}_arm_radius", f"{side}_arm_wrist"]]
for col, (clip, phase) in enumerate(samples):
    anim = doc["animations"][clip]
    shoe, world, _ = evaluate(anim, phase)
    for row, horizontal in enumerate([0, 2]):
        ax = axes[row, col]
        ax.set_facecolor("#101b27")
        for ci, chain in enumerate(chains):
            p = np.array([world(rig.id(n))[:3, 3] for n in chain])
            ax.plot(p[:, horizontal], p[:, 1], "o-", linewidth=2, markersize=3, color=["#e2e8f0", "#71dbc9", "#71dbc9", "#80aee8", "#80aee8"][ci])
        ax.scatter(shoe[::6, horizontal], shoe[::6, 1], s=.7, color="#dba686", alpha=.65)
        ax.axhline(0, color="#637485", linewidth=1)
        ax.set_xlim(-.65, .65);ax.set_ylim(-.035, 1.8);ax.set_aspect("equal")
        ax.tick_params(colors="#8ea1b5", labelsize=8)
        for sp in ax.spines.values(): sp.set_visible(False)
        ax.set_title(anim["name"] + f" / {phase:.2f}", color="#c3d2df", fontsize=9)
fig.tight_layout()
fig.savefig(destination / "motion-qa.png", dpi=150)
Path(destination / "animation-checks.json").write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
assert report["head_sync_max_matrix_error"] < .0001
assert report["shoe_penetration_minimum_m"] > -.005, "shoe penetration exceeds 5 mm"
