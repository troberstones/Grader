#!/usr/bin/env node
/**
 * Seed sample rubrics for Shading, Animation, Modeling, Rigging,
 * Effects, Storyboarding, and Previs.
 *
 * Usage:
 *   node scripts/seed-rubrics.mjs
 */

import Database from "better-sqlite3";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const DB_PATH = resolve(root, "storage", "grader.db");

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ── Rubric definitions ────────────────────────────────────────────────────────

const RUBRICS = [
  {
    name: "Shading",
    description: "Evaluates the quality of surface shading, material authoring, and lighting in a rendered scene.",
    criteria: [
      {
        name: "Light Response",
        description: "How accurately and convincingly surfaces respond to light — diffuse falloff, highlights, and shadow termination.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Light behaves physically accurately across all surfaces. Highlights, diffuse gradients, and shadow terminators are correct and convincing. No light leaks or unphysical artefacts." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Light response is mostly correct but one or two surfaces show slightly off specular width, minor light leaks, or a shadow terminator that is too sharp or too soft." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Several surfaces ignore realistic light behavior — flat diffuse, blown-out or absent specular, or harsh unblended shadow edges that break believability." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Default or untouched lighting with no attempt to adjust light response. Surfaces appear uniformly lit or completely unlit." },
        ],
      },
      {
        name: "Material Authoring",
        description: "Quality of shader graphs or material nodes — roughness, metalness, IOR, subsurface, and other physically based parameters.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Materials use PBR values grounded in real-world references. Roughness variation, correct IOR, and measured albedo values combine to produce convincing, layered surface reads." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Materials are mostly PBR-correct but roughness or metalness may be slightly uniform, IOR is approximate, or a secondary material is noticeably placeholder." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Materials rely on arbitrary slider values without physical grounding. Surfaces are either too uniformly rough/smooth or show obvious default-shader characteristics." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Default materials with little or no parameter adjustment. No evidence of intentional material design." },
        ],
      },
      {
        name: "Texture Maps",
        description: "Resolution, cleanliness, and integration of albedo, roughness, normal, and any additional maps.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "All maps are high-resolution, properly tiled, and seamlessly integrated. Normal maps add convincing micro-surface detail without artefacts. No visible seams or repetition." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Maps are generally clean but minor tiling repetition, a low-resolution patch, or a seam is visible on close inspection." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Maps are low-resolution, show obvious tiling, or are incorrectly connected in the shader. Normal map banding or incorrect tangent space is visible." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Textures are absent, still placeholder colors, or completely wrong resolution. No attempt at map integration." },
        ],
      },
      {
        name: "Lighting Setup",
        description: "Composition and motivation of the light rig — key, fill, rim, and environment contribution.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Lights are motivated by a clear source, balanced in intensity and color temperature, and reveal form without flattening or over-exposing the subject. Environment contribution is controlled." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Light rig reads well overall but fill or rim is slightly too bright/dark, or color temperature is inconsistent between lights." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Lighting is either too flat (no separation of key/fill), too contrasty (no fill), or unmotivated. Subject form is not clearly revealed." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Default scene light or a single light with no creative intent. No effort to support the subject with purposeful lighting." },
        ],
      },
      {
        name: "Render Quality",
        description: "Render settings — sampling, noise, GI accuracy, and final image cleanliness.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Final render is noise-free at production resolution. GI, caustics (if present), and volumetrics are converged. Render settings demonstrate understanding of sampling and denoising trade-offs." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Render is clean in hero areas but residual noise or fireflies appear in shadows or reflections. Resolution and output settings are appropriate." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Noticeable noise, banding, or GI splotches diminish the image. Low sample count or incorrect light cache settings are evident." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Extremely low sample count, viewport render quality, or render not submitted at final resolution." },
        ],
      },
    ],
  },

  {
    name: "Animation",
    description: "Evaluates the quality of motion, timing, weight, character performance, and technical execution of an animated shot.",
    criteria: [
      {
        name: "Timing & Spacing",
        description: "Correctness of frame timing, anticipation, ease-in/ease-out, and the distribution of keyframes to convey weight and rhythm.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Timing is intentional throughout. Anticipation frames are well-placed, spacing curves convey mass and rhythm, and holds read clearly without going dead." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Timing is mostly convincing but one or two actions feel slightly rushed, dragged, or missing a beat of anticipation." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Timing is largely mechanical — linear keys, missing anticipation, or actions that complete too quickly or slowly to feel weighted." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Near-default or stepped keys with no evidence of timing decisions. Motion reads as unintentional." },
        ],
      },
      {
        name: "Weight & Follow-Through",
        description: "Believability of mass, secondary motion, overlapping action, and how momentum carries through after a primary action.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Mass is clearly communicated through overlapping action and follow-through. Secondary elements (hair, clothing, accessories) settle naturally after primary motion stops." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Weight reads well in primary actions but secondary motion is slightly stiff, simultaneous rather than overlapping, or snaps to a stop." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Subject appears weightless or rubber-like. Little or no follow-through; secondary elements move in sync with rather than lagging the primary." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "No evidence of weight or secondary animation. All parts move and stop simultaneously with no overlap." },
        ],
      },
      {
        name: "Character Performance",
        description: "Clarity and expressiveness of pose, facial animation, and the communication of intent or emotion.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Poses are clear silhouettes that read in one frame. Facial animation and body language tell a cohesive micro-story. Performance is specific and avoids generic motion." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Performance communicates the intended emotion but one or two poses are ambiguous, or facial and body animation are slightly misaligned in timing." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Poses are weak silhouettes or stock positions. Facial animation is stiff or disconnected from body performance. Intent is unclear." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "No clear performance. Character is in T-pose, resting idle, or movement has no readable intent." },
        ],
      },
      {
        name: "Graph Editor / Curve Quality",
        description: "Cleanliness and intentionality of animation curves — no pops, no unnecessary keys, smooth tangent handles.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Curves are clean with no pops or unwanted oscillations. Tangents are manually adjusted to match intended spacing. Unnecessary keys have been removed. Channel curves read as intentional shapes." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Curves are mostly clean but a few channels show auto-tangent overshoots, redundant in-between keys, or minor pops at transitions." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Curves show significant auto-tangent artifacts, multiple unnecessary keys, or obvious pops and snaps visible in the viewport." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Curves appear entirely auto-generated with no manual adjustment. Default linear or stepped tangents throughout." },
        ],
      },
      {
        name: "Scene & Camera Polish",
        description: "Framing, camera movement, scene layout, and overall presentation of the animation.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Camera framing follows cinematographic principles (rule of thirds, motivated moves, appropriate lens). Scene layout is clean, clipping range is correct, and playblast or render is at full resolution." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Framing is generally good but camera may drift, cut off part of the action, or use a default lens that does not serve the shot." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Camera is a perspective viewport with no intent. Framing cuts off the character or is too distant to read performance. Scene is cluttered or has visible technical issues." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Default viewport playblast at low resolution with no framing consideration." },
        ],
      },
    ],
  },

  {
    name: "Modeling",
    description: "Evaluates polygon modeling quality, topology, surface detail, UV layout, and scene organization.",
    criteria: [
      {
        name: "Form & Proportions",
        description: "Accuracy of overall shape and proportions relative to the reference or design brief.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Model matches reference silhouette and proportions from all angles. Major and minor form landmarks are correctly placed and volumes read accurately." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Overall form is convincing but one or two secondary volumes (e.g., a limb, a panel) are slightly off in proportion or placement." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Major proportional errors are present — overall silhouette reads as a different object or departs significantly from the reference." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Primitive shapes with no attempt to match form or design intent." },
        ],
      },
      {
        name: "Edge Flow & Topology",
        description: "Quality of edge loop distribution — support loops, poles, and suitability for subdivision or deformation.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Edge loops follow natural form contours and deformation paths. Support loops are placed for clean subdivisions. Poles are minimal and located in non-deforming areas." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Topology is mostly clean but contains a few stray edge loops, misplaced poles, or slightly uneven face distribution that would cause minor pinching at subdivision." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Significant topology problems — N-gons in deforming areas, star poles causing surface pinching, or entirely box-modeled regions with no edge loop consideration." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Unmodified primitives or boolean-only construction with no topology cleanup." },
        ],
      },
      {
        name: "Surface Detail",
        description: "Appropriateness and quality of modeled detail — bevels, panels, embossed elements, and micro-detail for the intended render distance.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Detail density matches the intended render distance — production-level detail where visible, restrained where not. Bevels catch light convincingly and panel lines are clean and consistent." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Detail is generally appropriate but bevels are slightly too wide/narrow in places, or some panel lines are inconsistent in depth or width." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Surface is either over-detailed (noisy, difficult to read) or under-detailed (flat, no bevel, no panel interest). Detail does not match render intent." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Raw primitive geometry with no surface refinement, bevels, or intentional detail." },
        ],
      },
      {
        name: "UV Layout",
        description: "Quality of UV unwrap — seam placement, texel density consistency, and packing efficiency.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "UVs are fully unwrapped with seams hidden in non-visible areas. Texel density is consistent across all shells. UVs are packed efficiently with minimal wasted space and no overlaps." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "UVs are mostly correct but one or two shells have visible seam placement issues, minor texel density variation, or slight overlap." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "UVs are partially unwrapped — some faces use automatic projection leaving obvious stretching, or seams are placed in highly visible regions." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Default cubic/spherical projection with no manual unwrapping. Severe stretching evident on textured renders." },
        ],
      },
      {
        name: "Scene Organization",
        description: "Naming, hierarchy, layer/group structure, and overall cleanliness of the scene file.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "All objects are named descriptively and consistently. Hierarchy reflects logical groupings. No orphaned nodes, empty groups, or history/construction history left uncleaned." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Most objects are named and grouped logically but a few items retain default names (e.g., Mesh.001) or construction history is present on finished objects." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Majority of objects have default names, hierarchy is flat or absent, and the scene contains significant stray geometry or uncleaned history." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "No naming, grouping, or organization. Single flat scene with all-default names and no hierarchy." },
        ],
      },
    ],
  },

  {
    name: "Rigging",
    description: "Evaluates skeleton design, skin weighting, control rig setup, deformation quality, and overall rig usability for animators.",
    criteria: [
      {
        name: "Skeleton Structure",
        description: "Joint placement, hierarchy, and alignment relative to the mesh and deformation needs.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Joints are placed at anatomically or mechanically correct pivot points with proper orientation axes. Hierarchy is clean and logical. Joint chain lengths respect the mesh silhouette." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Joint placement is mostly correct but one or two joints have slightly off-axis orientation or a minor pivot misalignment that causes a small pop in rotation." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Several joints are mis-placed or mis-oriented, causing unwanted rotational behavior. Hierarchy does not reflect the intended deformation order." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Skeleton is minimal or default — joints placed without consideration of the mesh or intended motion." },
        ],
      },
      {
        name: "Skin Weighting",
        description: "Quality of vertex weight painting — smooth deformations with no candy-wrapping, pinching, or collapsing.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Deformations are smooth and predictable across full range of motion. No candy-wrapping, pinching at joints, or volume collapse. Corrective shapes or weight transfers are used where needed." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Weights are mostly clean but one or two joints show minor pinching or slight volume loss at extreme poses." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Multiple joints produce noticeable pinching, collapsing, or candy-wrapping in standard poses. Weights appear auto-generated with minimal manual correction." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Auto-skin weights with no manual painting. Severe deformation artifacts visible in any non-neutral pose." },
        ],
      },
      {
        name: "Control Setup",
        description: "Design and usability of animator-facing controls — shapes, color-coding, constraint logic, and attribute organization.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Controls use intuitive curve shapes sized to the mesh, are color-coded by side and function, and have clean channel boxes with only animator-relevant attributes exposed. IK/FK blend or space switches work without popping." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Controls are functional and generally well-labeled but a few are ambiguously shaped, not color-coded, or expose unnecessary attributes that clutter the channel box." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Controls are basic locators or default joint shapes with no visual differentiation. Attribute organization is absent — animators must know joint names to drive the rig." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "No control rig — animators would need to manipulate raw joints or geometry directly." },
        ],
      },
      {
        name: "Deformation Quality",
        description: "Overall mesh deformation across a full range of motion — correctness at extremes and believability at mid-poses.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Mesh deforms cleanly through the full intended range of motion. Volume is preserved at joints. Any corrective blend shapes or driven keys eliminate artifacts at key poses." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Deformation is clean through most of the range but one or two extreme poses show minor volume loss or mesh interpenetration that was not corrected." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Deformation artifacts (volume collapse, interpenetration, polygon flipping) are visible within a typical animator's working range, not just at extreme limits." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Mesh breaks or collapses with any meaningful joint rotation. Deformation has not been tested beyond the bind pose." },
        ],
      },
      {
        name: "Rig Usability",
        description: "How practical the rig is for an animator — performance, predictable behavior, and documentation or picker setup.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 25, description: "Rig plays back in real time at scene frame rate. All controls behave predictably when keyed. A picker or control guide is provided. Rig can be imported into a shot file without breaking." },
          { level: 2, label: "Good with Minor Flaws",    points: 18, description: "Rig is usable but has minor performance lag, one or two controls that behave unexpectedly when rotated in certain orders, or lacks documentation." },
          { level: 1, label: "Lacking Key Aspects",      points: 10, description: "Rig is slow or unreliable — controls flip at certain values, constraints behave unexpectedly, or the rig only works in the original scene file." },
          { level: 0, label: "Little / No Effort",        points:  3, description: "Rig is non-functional or only partially set up. Not usable by an animator in its current state." },
        ],
      },
    ],
  },
  // ── 100-point rubrics (5 criteria × 20 pts max) ───────────────────────────

  {
    name: "Effects",
    description: "Evaluates the design, execution, and scene integration of dynamic simulations and visual effects.",
    criteria: [
      {
        name: "Simulation Setup",
        description: "Quality of solver configuration — collision objects, emitters, forces, and cache management.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Solver settings are tuned to the shot's scale and timing. Collision geometry is clean, forces are motivated, and the simulation is fully cached and repeatable. No stray particles or solver instabilities." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Simulation is mostly stable and well-configured but minor issues remain — occasional stray elements, a slightly incorrect collision offset, or forces that are marginally over/under-tuned." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Simulation uses near-default solver settings with little adjustment. Collisions are inaccurate, emitters are poorly timed, or the simulation is uncached and produces inconsistent results." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Default simulation preset with no configuration. Effect does not match the shot's context or intent." },
        ],
      },
      {
        name: "Visual Complexity & Detail",
        description: "Richness of the effect — element count, layering of scales, and overall visual interest.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Effect has well-layered detail across multiple scales (large forms, mid-detail, fine wisps or debris). Element count is sufficient to read at render resolution without appearing sparse or repetitive." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Effect reads well overall but one scale of detail is under-developed — e.g., a fluid sim with good primary volume but no fine trailing tendrils, or a particle system missing secondary debris." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Effect is visually thin — too few elements, no layering of scales, or heavy repetition that makes the procedural origin obvious." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "A single unmodified emitter or default preset with no layering or artistic development." },
        ],
      },
      {
        name: "Scene Integration",
        description: "How convincingly the effect interacts with and belongs in the scene — lighting, color, shadows, and physical interaction.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Effect lighting matches scene illumination. Color and density are graded to the environment. The effect casts or receives shadows correctly and physically interacts with scene geometry where expected." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Effect is mostly integrated but subtle mismatches remain — slightly wrong light color, a shadow that does not connect to the ground, or density that reads as composited rather than in-world." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Effect is clearly disconnected from the scene — wrong lighting direction, no shadow contribution, or color that belongs to a different environment." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Effect rendered in isolation or with default white lighting. No attempt to match the scene." },
        ],
      },
      {
        name: "Art Direction",
        description: "How well the effect serves the creative intent — shape language, timing, and emotional read.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "The effect has a clear visual direction — distinctive silhouette, deliberate timing, and an emotional quality that supports the shot. It looks designed, not just simulated." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Art direction is evident but the effect leans slightly toward default simulation aesthetics in one area — e.g., timing that peaks too early or a silhouette that reads as generic." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Effect appears entirely unguided — whatever the solver produced by default. No evident decisions about shape, timing, or mood." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Default preset output presented without creative consideration." },
        ],
      },
      {
        name: "Performance & Stability",
        description: "Scene playback performance, cache hygiene, and absence of solver crashes or inconsistent results.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Simulation is fully cached and plays back at real time. No solver warnings in the output log. Scene file opens and plays identically on a second machine." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Simulation is cached and stable but playback drops below real time at peak complexity, or minor solver warnings appear that do not affect the final result." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Simulation is uncached or partially cached, requiring re-simulation to play back. Solver errors are present that affect visual output." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Simulation crashes, produces different results each run, or is left in an interactive (non-cached) state." },
        ],
      },
    ],
  },

  {
    name: "Storyboarding",
    description: "Evaluates the clarity, visual storytelling, drawing quality, camera language, and pacing of a storyboard.",
    criteria: [
      {
        name: "Shot Composition",
        description: "Use of framing, negative space, rule of thirds, and visual balance within each panel.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Every panel uses deliberate compositional principles — clear foreground/midground/background separation, intentional negative space, and a single strong focal point. Compositions are varied and support the story beat." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Compositions are generally strong but one or two panels feel crowded, too centered, or lack clear depth layers." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Panels are mostly centered with little compositional intent. Depth is flat, focal points are ambiguous, or multiple panels share the same static composition." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Panels are empty, stick-figure placeholders, or show no framing intent whatsoever." },
        ],
      },
      {
        name: "Camera Language",
        description: "Intentional use of shot types (OTS, POV, wide, close-up) and camera movement arrows to communicate cinematographic direction.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "A varied vocabulary of shot types is used purposefully — scale changes are motivated, screen direction is consistent across cuts, and camera move arrows clearly indicate pan, tilt, push, or pull intent." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Shot types are mostly appropriate but camera movement notation is missing from one or two panels, or screen direction flips once without a motivated cut." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Shot types are repetitive (e.g., all medium shots) or chosen without narrative motivation. Camera movement is rarely indicated or inconsistently annotated." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "All panels use the same framing with no camera direction indicated." },
        ],
      },
      {
        name: "Clarity of Action",
        description: "How immediately readable each panel is — the viewer should understand who is doing what without reading the caption.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Action is readable in each panel at a glance. Poses are expressive silhouettes, motion lines are used effectively, and the sequence of events is unambiguous without caption support." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Most actions read clearly but one or two panels require the caption to be understood, or a character's pose is ambiguous about which direction they are moving." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Several panels are unclear without captions. Poses are stiff or identical across beats, and motion is not communicated through drawing." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Panels are not self-explanatory even with captions. Action cannot be determined from the drawings." },
        ],
      },
      {
        name: "Drawing Quality & Consistency",
        description: "Confidence of line work, character model consistency across panels, and environmental legibility.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Line work is confident and purposeful. Characters maintain consistent proportions and recognizable design across all panels. Environments are clear enough to orient the viewer in every scene change." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Drawing quality is generally good but character proportions shift noticeably in one or two panels, or a location change lacks an establishing environment." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Line work is hesitant or scratchy, characters are difficult to distinguish from each other or change appearance significantly between panels, and environments are absent or illegible." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Panels are sketched so roughly that characters and environments cannot be identified." },
        ],
      },
      {
        name: "Pacing & Panel Sequencing",
        description: "Rhythm of panel beats — how well the number and duration of panels conveys the intended pace of the sequence.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Panel count reflects narrative pacing — fast action is broken into more panels, slow emotional beats hold longer. Transitions between panels are purposeful (match cut, jump cut, etc.) and the sequence has a clear beginning, climax, and resolution." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Pacing reads well overall but one section rushes through a key beat or over-extends a minor action, slightly disrupting the rhythm." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Panel count is uniform regardless of action intensity. Transitions are arbitrary and the sequence lacks a sense of rhythm or structural arc." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Too few panels to represent the sequence, or panels are in no apparent order." },
        ],
      },
    ],
  },

  {
    name: "Previs",
    description: "Evaluates the completeness, cinematographic quality, editorial timing, staging, and communicative value of a previsualization.",
    criteria: [
      {
        name: "Shot Coverage & Completeness",
        description: "Whether all required shots are represented and the previs tells a complete, unambiguous version of the sequence.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Every required shot is present and cut together into a complete sequence. No story beats are skipped or implied. A viewer unfamiliar with the script can follow the full action from previs alone." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Coverage is mostly complete but one shot is missing, a coverage gap requires inference, or a transition between scenes is unrepresented." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Several shots are missing or represented by static placeholder frames. The sequence cannot be understood without referring to a script or storyboard." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Only a fraction of the required shots are present. Work is clearly incomplete." },
        ],
      },
      {
        name: "Camera Work & Cinematography",
        description: "Quality of virtual camera choices — lens, height, angle, and movement — in service of the story.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Camera choices are intentional and cinematographically grounded. Lens length is appropriate to the shot type, camera moves are motivated and smooth, and framing respects the 180-degree rule across the sequence." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Camera work is mostly sound but one shot uses an unmotivated move, the default lens is left on an atypical shot type, or a minor axis crossing occurs." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Default perspective camera used throughout with no lens or move adjustment. Camera placement does not serve the action and axis violations are present." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Viewport playblasts with no camera object. Framing is incidental." },
        ],
      },
      {
        name: "Timing & Editorial Cut",
        description: "How well the cut timing communicates action, performance, and pacing when viewed as a continuous edit.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Cut points land on motivated action beats. Shot lengths reflect narrative pace — action is quick, drama breathes. The edited sequence could be handed directly to an editor as a timing reference." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Timing is generally readable but one or two shots are held too long or cut too early, interrupting the rhythm at key beats." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Shot durations appear arbitrary. Cuts do not align with action beats, making the pacing hard to read." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Shots are unedited or played at uniform duration with no timing consideration." },
        ],
      },
      {
        name: "Scene Layout & Staging",
        description: "Accuracy and clarity of set dressing, character blocking, and spatial relationships between elements.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "Scene layout clearly communicates spatial relationships — characters are blocked relative to each other and the environment, set pieces are correctly scaled, and sightlines between characters are obvious from the camera." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Staging is mostly clear but one spatial relationship is ambiguous (e.g., unclear whether two characters are facing each other), or a major set piece is missing or incorrectly scaled." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "Scene is minimally dressed — characters float in empty space with no environmental context. Blocking does not communicate the intended spatial story." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "Default scene with no layout, dressing, or blocking. Characters are in T-pose or absent." },
        ],
      },
      {
        name: "Communication of Intent",
        description: "How effectively the previs functions as a production communication tool — clarity of action, VFX beats, and notes.",
        weight: 1,
        levels: [
          { level: 3, label: "Professional / Mastery",   points: 20, description: "The previs communicates all key production decisions — VFX beats are clearly flagged (title cards or proxy geometry), stunt or complex action moments are unambiguous, and the output file is correctly named and formatted for handoff." },
          { level: 2, label: "Good with Minor Flaws",    points: 15, description: "Most production intent is clear but one VFX or stunt beat lacks proxy representation, or the file naming/format does not match the handoff spec." },
          { level: 1, label: "Lacking Key Aspects",      points:  8, description: "VFX and stunt beats are not indicated. A production team receiving this previs would need significant clarification before being able to use it." },
          { level: 0, label: "Little / No Effort",        points:  2, description: "No production notes, proxies, or handoff formatting. Previs communicates only the most basic spatial information." },
        ],
      },
    ],
  },
];

// ── Prepared statements ───────────────────────────────────────────────────────

const insertRubric = db.prepare(`
  INSERT INTO rubrics (name, description) VALUES (@name, @description)
`);
const insertCriterion = db.prepare(`
  INSERT INTO rubric_criteria (rubric_id, name, description, sort_order, weight)
  VALUES (@rubricId, @name, @description, @sortOrder, @weight)
`);
const insertLevel = db.prepare(`
  INSERT INTO rubric_levels (criteria_id, level, label, description, points)
  VALUES (@criteriaId, @level, @label, @description, @points)
`);
const findRubric = db.prepare(`SELECT id FROM rubrics WHERE name = ?`);

// ── Seed ─────────────────────────────────────────────────────────────────────

const run = db.transaction(() => {
  for (const rubric of RUBRICS) {
    const existing = findRubric.get(rubric.name);
    if (existing) {
      console.log(`  ~ Skipping "${rubric.name}" — already exists (id ${existing.id})`);
      continue;
    }

    const { lastInsertRowid: rubricId } = insertRubric.run({ name: rubric.name, description: rubric.description });
    console.log(`  + Created rubric "${rubric.name}" (id ${rubricId})`);

    rubric.criteria.forEach((criterion, i) => {
      const { lastInsertRowid: criteriaId } = insertCriterion.run({
        rubricId,
        name: criterion.name,
        description: criterion.description,
        sortOrder: i,
        weight: criterion.weight,
      });

      for (const lvl of criterion.levels) {
        insertLevel.run({ criteriaId, level: lvl.level, label: lvl.label, description: lvl.description, points: lvl.points });
      }
    });
  }
});

console.log("\nSeeding rubrics...\n");
run();
console.log("\nDone!\n");
db.close();
