"""Retarget a supplied FBX motion onto the existing high-heel character.

The source JSON is the bind skeleton and animation tracks exported by
Three.js FBXLoader 0.180.0. No source meshes/materials are imported.
Only the named animation changes; all other clips, meshes and skins remain.
The optional fifth argument is Idle_Heels, Run_Heels or Rifle_Aim_Idle.
"""
import copy
import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from scipy.spatial.transform import Rotation as Rot, Slerp

from bake_locomotion import Rig


class SourceMotion:
    def __init__(self, path):
        self.data = json.loads(Path(path).read_text())
        self.nodes = self.data["nodes"]
        self.ids = {}
        # FBX contains zero-length end bones with duplicate names. Animation
        # tracks bind to the first match, just as Three.js PropertyBinding does.
        for i, n in enumerate(self.nodes):
            self.ids.setdefault(n["name"], i)
        self.rest = []
        for n in self.nodes:
            m = np.eye(4)
            m[:3, :3] = Rot.from_quat(n["quaternion"]).as_matrix() @ np.diag(n["scale"])
            m[:3, 3] = n["position"]
            self.rest.append(m)
        self.clip = next(a for a in self.data["animations"] if a["tracks"])
        self.period = self.clip["duration"]
        self.tracks = []
        for t in self.clip["tracks"]:
            name, kind = t["name"].rsplit(".", 1)
            i = self.ids[name]
            times = np.array(t["times"])
            values = np.array(t["values"]).reshape(-1, 4 if kind == "quaternion" else 3)
            interpolator = Slerp(times, Rot.from_quat(values)) if kind == "quaternion" and len(times)>1 else None
            self.tracks.append((i, kind, times, values, interpolator))
        self.local = [m.copy() for m in self.rest]
        self.rest_world = self.worlds()

    def id(self, name):
        return self.ids["mixamorig" + name]

    def worlds(self):
        cache = {}
        def world(i):
            if i not in cache:
                parent = self.nodes[i]["parent"]
                cache[i] = world(parent) @ self.local[i] if parent is not None else self.local[i]
            return cache[i]
        return [world(i) for i in range(len(self.nodes))]

    def sample(self, phase):
        t = min(self.period, max(0, phase * self.period))
        self.local = [m.copy() for m in self.rest]
        for i, kind, times, values, interpolator in self.tracks:
            tt = np.clip(t, times[0], times[-1])
            if kind == "quaternion":
                self.local[i][:3, :3] = interpolator(tt).as_matrix() if interpolator is not None else Rot.from_quat(values[0]).as_matrix()
            elif kind == "position":
                self.local[i][:3, 3] = [np.interp(tt, times, values[:, k]) for k in range(3)]
        return self.worlds()


def read_glb(path):
    b = Path(path).read_bytes()
    n = struct.unpack_from("<I", b, 12)[0]
    return json.loads(b[20:20+n]), b[28+n:]


def main(target_path, source_path, output_path, report_path, clip_name="Walk_Heels"):
    assert clip_name in {"Walk_Heels", "Run_Heels", "Idle_Heels", "Rifle_Aim_Idle"}
    doc, binary = read_glb(target_path)
    rig = Rig(copy.deepcopy(doc), binary)
    source = SourceMotion(source_path)
    source_name = source.data.get("sourceFile", "Female Walk.fbx")
    locomotion = clip_name in {"Walk_Heels", "Run_Heels"}
    source_h = source.id("Hips")
    first, last = source.sample(0), source.sample(1)
    drift = last[source_h][:3, 3] - first[source_h][:3, 3]
    drift[1] = 0
    source_leg_length = sum(np.linalg.norm(source.rest_world[source.id(a)][:3, 3] - source.rest_world[source.id(b)][:3, 3]) for a, b in [("LeftUpLeg", "LeftLeg"), ("LeftLeg", "LeftFoot")])
    target_leg_length = sum(np.linalg.norm(rig.rest[rig.id(n)][:3, 3]) for n in ["l_leg_tibia", "l_leg_ankle"])
    metres_per_source_unit = target_leg_length / source_leg_length

    # Align left touchdown to the existing running cycle, for a coherent
    # walk/run crossfade. Pick a forward, low left foot from the source cycle.
    scan = np.linspace(0, 1, 241)[:-1]
    scores = []
    for phase in scan:
        w = source.sample(phase)
        foot, hip = w[source.id("LeftFoot")][:3, 3], w[source_h][:3, 3]
        toe = w[source.id("LeftToeBase")][:3, 3]
        low_sole = min(foot[1]-source.rest_world[source.id("LeftFoot")][1,3], toe[1]-source.rest_world[source.id("LeftToeBase")][1,3])
        if low_sole < .8 and foot[1] < source.rest_world[source.id("LeftFoot")][1, 3]+2:
            scores.append((float(foot[2] - hip[2]), phase))
    phase_offset = max(scores)[1] if locomotion and scores else 0.

    # source name, target name, source child, target child
    pairs = [("Hips", "hips", None, None),
             ("Spine", "spine_0", "Spine1", "spine_1"),
             ("Spine1", "spine_1", "Spine2", "spine_2"),
             ("Spine2", "spine_2", "Neck", "neck_0"),
             ("Neck", "neck_0", "Head", "neck_1"),
             ("Head", "head", None, None)]
    for side, prefix in [("l", "Left"), ("r", "Right")]:
        pairs += [(prefix+"Shoulder", side+"_arm_clavicle", prefix+"Arm", side+"_arm_humerus"),
                  (prefix+"Arm", side+"_arm_humerus", prefix+"ForeArm", side+"_arm_radius"),
                  (prefix+"ForeArm", side+"_arm_radius", prefix+"Hand", side+"_arm_wrist"),
                  (prefix+"Hand", side+"_arm_wrist", prefix+"HandMiddle1", side+"_hand_middle_0"),
                  (prefix+"UpLeg", side+"_leg_femur", prefix+"Leg", side+"_leg_tibia"),
                  (prefix+"Leg", side+"_leg_tibia", prefix+"Foot", side+"_leg_ankle")]
        for finger, target, start in [("Thumb", "thumb", 0), ("Index", "index", 0), ("Middle", "middle", 0), ("Ring", "ring", 1), ("Pinky", "little", 1)]:
            for k in range(3):
                target_name = f"{side}_hand_{target}_{k+start}"
                child = f"{side}_hand_{target}_{k+start+1}"
                if "Body/"+child not in rig.ids:
                    child = None
                pairs.append((prefix+f"Hand{finger}{k+1}", target_name, prefix+f"Hand{finger}{k+2}" if child else None, child))

    mappings = []
    for src_name, target_name, src_child, target_child in pairs:
        si, ti = source.id(src_name), rig.id(target_name)
        target_basis = rig.world_rest[ti][:3, :3]
        if src_child and target_child:
            a = rig.world_rest[rig.id(target_child)][:3, 3] - rig.world_rest[ti][:3, 3]
            b = source.rest_world[source.id(src_child)][:3, 3] - source.rest_world[si][:3, 3]
            target_basis = rig.align(a, b) @ target_basis
        elif "_hand_" in target_name:
            # A terminal phalanx has no child marker. Its incoming segment
            # still defines its axis; include that basis correction so the
            # fingertip does not keep the imported arm pose's orientation.
            a = rig.world_rest[ti][:3,3] - rig.world_rest[rig.parent[ti]][:3,3]
            source_parent = source.nodes[si]["parent"]
            b = source.rest_world[si][:3,3] - source.rest_world[source_parent][:3,3]
            target_basis = rig.align(a, b) @ target_basis
        correction = source.rest_world[si][:3, :3].T @ target_basis
        mappings.append((ti, si, correction))
    mappings.sort()

    cog = rig.id("COG")
    # Preserve target leg roll from the source; IK changes the direction only.
    def solve_leg(side, target, ankle_rotation):
        thigh, shin, ankle = [rig.id(f"{side}_leg_{s}") for s in ["femur", "tibia", "ankle"]]
        hip = rig.world(thigh)[:3, 3]
        old_knee = rig.world(shin)[:3, 3]
        upper_r, lower_r = rig.world(thigh)[:3, :3], rig.world(shin)[:3, :3]
        a, b = np.linalg.norm(rig.rest[shin][:3, 3]), np.linalg.norm(rig.rest[ankle][:3, 3])
        v = target - hip
        distance = min(np.linalg.norm(v), a+b-.0002)
        direction = v / np.linalg.norm(v)
        advance = (a*a-b*b+distance*distance)/(2*distance)
        height = math.sqrt(max(a*a-advance*advance, 0))
        pole = old_knee - hip
        pole -= direction*np.dot(pole, direction)
        if np.linalg.norm(pole)<1e-5:
            pole = np.array([0., 0., 1.]);pole -= direction*np.dot(pole, direction)
        pole /= np.linalg.norm(pole)
        desired_knee = hip+direction*advance+pole*height
        rig.rotation(thigh, rig.align(upper_r@rig.rest[shin][:3, 3], desired_knee-hip) @ upper_r)
        knee = rig.world(shin)[:3, 3]
        rig.rotation(shin, rig.align(lower_r@rig.rest[ankle][:3, 3], target-knee) @ lower_r)
        rig.rotation(ankle, ankle_rotation)

    frames, pelvis_adjustments, contact_masks = [], [], []
    frame_count = max(72, int(round(source.period * 30)))
    for frame in range(frame_count+1):
        phase = frame/frame_count
        src_phase = (phase+phase_offset) % 1
        w = source.sample(src_phase)
        rig.reset()
        hip_delta = w[source_h][:3, 3] - source.rest_world[source_h][:3, 3] - drift*src_phase
        rig.local[cog][:3, 3] += hip_delta*metres_per_source_unit
        rig.translated.add(cog)
        for ti, si, correction in mappings:
            rig.rotation(ti, w[si][:3, :3] @ correction)

        targets, contacts, lower = [], [], 0.
        for side, prefix in [("l", "Left"), ("r", "Right")]:
            ankle = rig.id(side+"_leg_ankle")
            sf, st = source.id(prefix+"Foot"), source.id(prefix+"ToeBase")
            foot_delta = w[sf][:3, :3] @ source.rest_world[sf][:3, :3].T
            angles = Rot.from_matrix(foot_delta).as_euler("xyz")
            angles = np.clip(angles, np.radians([-12, -12, -9]), np.radians([18, 12, 9]))
            foot_rotation = Rot.from_euler("xyz", angles).as_matrix() @ rig.world_rest[ankle][:3, :3]
            target = rig.world(ankle)[:3, 3].copy()
            relative_sole = rig.soles[side] @ foot_rotation.T
            floor_y = -relative_sole[:, 1].min()
            clearance = min(w[sf][1, 3]-source.rest_world[sf][1, 3], w[st][1, 3]-source.rest_world[st][1, 3])
            # The toe remains in contact through heel rise. Tiny source noise
            # is removed without erasing the actual swing trajectory.
            lift = max(0., clearance-.65)*metres_per_source_unit
            contacts.append(bool(lift<.006))
            target[1] = floor_y+lift+.001
            pivot = rig.soles[side][np.argmin(relative_sole[:, 1])]
            target[2] -= (foot_rotation@pivot)[2]-pivot[2]
            hip = rig.world(rig.id(side+"_leg_femur"))[:3, 3]
            horizontal = np.linalg.norm((target-hip)[[0, 2]])
            max_vertical = math.sqrt(max((target_leg_length-.003)**2-horizontal**2, 0))
            lower = max(lower, hip[1]-target[1]-max_vertical)
            targets.append((side, target, foot_rotation))
        rig.local[cog][1, 3] -= lower
        pelvis_adjustments.append(lower)
        for side, target, rotation in targets:
            solve_leg(side, target, rotation)

        for i, n in enumerate(rig.nodes):
            name = n.get("name", "")
            body_i = rig.ids.get("Body/"+name[5:]) if name.startswith("Head/") else None
            if body_i is None or (body_i not in rig.rotated and name!="Head/spine_2"):
                continue
            desired = rig.world(body_i) @ np.linalg.inv(rig.world_rest[body_i]) @ rig.world_rest[i]
            parent_world = rig.world(rig.parent[i]) if i in rig.parent else np.eye(4)
            rig.local[i] = np.linalg.inv(parent_world) @ desired
            rig.rotated.add(i)
            if name=="Head/spine_2":rig.translated.add(i)
        frames.append([m.copy() for m in rig.local])
        contact_masks.append(contacts)

    new_binary = bytearray(binary)
    def accessor(array, kind):
        a = np.asarray(array, dtype="<f4")
        while len(new_binary)%4:new_binary.append(0)
        view = len(doc["bufferViews"])
        doc["bufferViews"].append({"buffer":0,"byteOffset":len(new_binary),"byteLength":a.nbytes})
        new_binary.extend(a.tobytes())
        meta={"bufferView":view,"componentType":5126,"count":len(a),"type":kind}
        if kind=="SCALAR":meta.update(min=[float(a.min())],max=[float(a.max())])
        doc["accessors"].append(meta)
        return len(doc["accessors"])-1
    time_id=accessor(np.linspace(0,source.period,frame_count+1),"SCALAR")
    stride=float(np.linalg.norm(drift[[0,2]])*metres_per_source_unit)
    anim={"name":clip_name,"channels":[],"samplers":[],"extras":{
        "inPlace":True,"loop":True,"sourceFile":source_name,"sourceClip":source.clip["name"],
        "sourceDuration":source.period,"sourcePhaseOffset":float(phase_offset),
        "referenceStrideDistance":stride,"referenceSpeed":stride/source.period,
        "footwear":"high-heels","toeMotion":"target shoe bind pose retained",
        "contactSamples":contact_masks,"generator":"FBX motion retarget with shoe-contact IK"}}
    for node_id,path in [(i,"rotation") for i in sorted(rig.rotated)]+[(i,"translation") for i in sorted(rig.translated)]:
        if path=="rotation":
            values=Rot.from_matrix(np.array([f[node_id][:3,:3] for f in frames])).as_quat()
            for k in range(1,len(values)):
                if np.dot(values[k],values[k-1])<0:values[k]*=-1
            kind="VEC4"
        else:
            values=np.array([f[node_id][:3,3] for f in frames]);kind="VEC3"
        values[-1]=values[0]
        sampler=len(anim["samplers"])
        anim["samplers"].append({"input":time_id,"output":accessor(values,kind),"interpolation":"LINEAR"})
        anim["channels"].append({"sampler":sampler,"target":{"node":node_id,"path":path}})
        n=doc["nodes"][node_id]
        if "matrix" in n:
            mat=rig.rest[node_id];n.pop("matrix");n["translation"]=mat[:3,3].tolist()
            n["rotation"]=Rot.from_matrix(mat[:3,:3]).as_quat().tolist();n["scale"]=[1,1,1]
    index=next((i for i,a in enumerate(doc["animations"]) if a["name"]==clip_name),None)
    if index is None:doc["animations"].append(anim)
    else:doc["animations"][index]=anim
    prefix = {"Walk_Heels":"walk", "Run_Heels":"run", "Idle_Heels":"idle", "Rifle_Aim_Idle":"aim"}[clip_name]
    doc["extras"]["locomotion"].update({prefix+"Period":source.period,prefix+"Source":source_name})
    if locomotion:doc["extras"]["locomotion"][prefix+"Stride"] = stride
    doc["buffers"]=[{"byteLength":len(new_binary)}]
    jb=json.dumps(doc,separators=(",",":"),ensure_ascii=False).encode();jb+=b" "*((-len(jb))%4)
    new_binary.extend(b"\x00"*((-len(new_binary))%4))
    total=12+8+len(jb)+8+len(new_binary)
    result=struct.pack("<III",0x46546c67,2,total)+struct.pack("<II",len(jb),0x4e4f534a)+jb+struct.pack("<II",len(new_binary),0x004e4942)+new_binary
    Path(output_path).write_bytes(result)
    report={"clip":clip_name,"sourceFile":source_name,"sourceDuration":source.period,"sourceBoneMappings":len(mappings),
            "phaseOffset":float(phase_offset),"metresPerSourceUnit":metres_per_source_unit,
            "strideDistance":stride,"referenceSpeed":stride/source.period,"frames":frame_count+1,
            "tracks":len(anim["channels"]),"maximumPelvisIKCorrectionM":max(pelvis_adjustments),"outputBytes":len(result)}
    Path(report_path).write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))


if __name__=="__main__":
    main(*sys.argv[1:])
