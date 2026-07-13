import { v } from "convex/values";

export const pillarValidator = v.string();

export const optionalPillarValidator = v.optional(pillarValidator);

export const promptTypeValidator = v.optional(v.union(
  v.literal("image_gen"),
  v.literal("video_gen"),
  v.literal("ui_design"),
  v.literal("cinematic"),
  v.literal("ugc_ad"),
  v.literal("workflow"),
  v.literal("component_prompt"),
  v.literal("page_prompt"),
  v.literal("other"),
));

export const generationTypeValidator = v.optional(v.union(
  v.literal("image_gen"),
  v.literal("video_gen"),
  v.literal("ui_design"),
  v.literal("workflow"),
  v.literal("other"),
));

export const modelProviderValidator = v.optional(v.union(
  v.literal("openai"),
  v.literal("anthropic"),
  v.literal("google"),
  v.literal("xai"),
  v.literal("meta"),
  v.literal("flux"),
  v.literal("midjourney"),
  v.literal("runway"),
  v.literal("other"),
));

export const workflowTypeValidator = v.optional(v.union(
  v.literal("component_prompt"),
  v.literal("page_prompt"),
  v.literal("system_prompt"),
  v.literal("asset_recipe"),
  v.literal("other"),
));

export const promptSectionsValidator = v.optional(v.object({
  finalPrompt: v.string(),
  negativePrompt: v.optional(v.string()),
  generationNotes: v.optional(v.string()),
}));

const creatorsPromptProfileValidator = v.object({
  pillar: v.literal("creators"),
  subjectType: v.optional(v.union(
    v.literal("person"),
    v.literal("couple"),
    v.literal("group"),
    v.literal("character"),
    v.literal("other"),
  )),
  framing: v.optional(v.union(
    v.literal("close_up"),
    v.literal("medium"),
    v.literal("full_body"),
    v.literal("wide"),
    v.literal("other"),
  )),
  cameraAngle: v.optional(v.union(
    v.literal("eye_level"),
    v.literal("high_angle"),
    v.literal("low_angle"),
    v.literal("overhead"),
    v.literal("dutch"),
    v.literal("other"),
  )),
  lighting: v.optional(v.union(
    v.literal("studio"),
    v.literal("natural"),
    v.literal("golden_hour"),
    v.literal("neon"),
    v.literal("dramatic"),
    v.literal("soft"),
    v.literal("other"),
  )),
  mood: v.optional(v.union(
    v.literal("editorial"),
    v.literal("luxury"),
    v.literal("casual"),
    v.literal("futuristic"),
    v.literal("cinematic"),
    v.literal("other"),
  )),
});

const designsPromptProfileValidator = v.object({
  pillar: v.literal("designs"),
  targetType: v.optional(v.union(
    v.literal("landing_page"),
    v.literal("website"),
    v.literal("dashboard"),
    v.literal("mobile_app"),
    v.literal("component"),
    v.literal("design_system"),
    v.literal("other"),
  )),
  style: v.optional(v.union(
    v.literal("minimal"),
    v.literal("editorial"),
    v.literal("brutalist"),
    v.literal("neobrutalism"),
    v.literal("glassmorphism"),
    v.literal("retro"),
    v.literal("corporate"),
    v.literal("other"),
  )),
  platform: v.optional(v.union(
    v.literal("web"),
    v.literal("ios"),
    v.literal("android"),
    v.literal("cross_platform"),
    v.literal("other"),
  )),
  workflowType: workflowTypeValidator,
});

const dumpPromptProfileValidator = v.object({
  pillar: v.literal("dump"),
  note: v.optional(v.string()),
});

export const promptProfileValidator = v.optional(v.union(
  creatorsPromptProfileValidator,
  designsPromptProfileValidator,
  dumpPromptProfileValidator,
));

export const tagCategoryValidator = v.optional(v.union(
  v.literal("model_name"),
  v.literal("style"),
  v.literal("content_type"),
  v.literal("platform"),
  v.literal("color"),
  v.literal("camera_angle"),
  v.literal("lighting"),
  v.literal("composition"),
  v.literal("car_make"),
  v.literal("car_model"),
  v.literal("car_angle"),
  v.literal("environment"),
  v.literal("design_style"),
  v.literal("design_type"),
  v.literal("workflow_type"),
  v.literal("component_type"),
  v.literal("custom"),
));

export const tagSourceValidator = v.optional(v.union(
  v.literal("user"),
  v.literal("agent"),
  v.literal("system"),
));

export const typedTagInputValidator = v.object({
  name: v.string(),
  category: tagCategoryValidator,
  pillar: optionalPillarValidator,
  source: tagSourceValidator,
});

export const designInspirationTypeValidator = v.union(
  v.literal("website"),
  v.literal("landing_page"),
  v.literal("dashboard"),
  v.literal("component"),
  v.literal("mobile_app"),
  v.literal("motion"),
  v.literal("branding"),
  v.literal("asset_pack"),
  v.literal("other"),
);

export const designCaptureKindValidator = v.union(
  v.literal("website"),
  v.literal("image"),
  v.literal("component"),
  v.literal("tutorial"),
);

export const designSaveIntentValidator = v.union(
  v.literal("utility"),
  v.literal("inspiration"),
  v.literal("component"),
  v.literal("tutorial"),
);

export const designPlatformValidator = v.optional(v.union(
  v.literal("web"),
  v.literal("ios"),
  v.literal("android"),
  v.literal("cross_platform"),
  v.literal("other"),
));

export const designInspirationStatusValidator = v.optional(v.union(
  v.literal("active"),
  v.literal("archived"),
));

export const designSaveTemplateDefaultsValidator = v.object({
  captureKind: v.optional(designCaptureKindValidator),
  saveIntent: v.optional(designSaveIntentValidator),
  inspirationType: v.optional(designInspirationTypeValidator),
  platform: designPlatformValidator,
  workflowType: workflowTypeValidator,
  tagNames: v.optional(v.array(v.string())),
});

export const assetRoleValidator = v.optional(v.union(
  v.literal("generated_output"),
  v.literal("reference"),
  v.literal("inspiration_capture"),
  v.literal("workflow_asset"),
  v.literal("cinema_frame"),
  v.literal("other"),
));

// Cinema metadata — used by the cinema-inspiration pillar. Frames have no prompt;
// the metadata describes the source film and any cinematographic notes (manual or
// agent-generated). All fields optional except movieTitle, which is the only hard
// requirement at ingest time.
export const cinemaMetadataValidator = v.optional(
  v.object({
    movieTitle: v.string(),
    director: v.optional(v.string()),
    year: v.optional(v.number()),
    scene: v.optional(v.string()),
    timecode: v.optional(v.string()),
    cinematographer: v.optional(v.string()),
    lens: v.optional(v.string()),
    aperture: v.optional(v.string()),
    composition: v.optional(v.string()),
    lighting: v.optional(v.string()),
    cameraMovement: v.optional(v.string()),
    colorPalette: v.optional(v.string()),
    mood: v.optional(v.string()),
    agentDescription: v.optional(v.string()),
    annotatedAssetId: v.optional(v.id("assets")),
  }),
);

export const ingestSourceValidator = v.optional(v.union(
  v.literal("api"),
  v.literal("agent"),
  v.literal("telegram"),
  v.literal("manual"),
  v.literal("import"),
));

export const lineageRoleValidator = v.union(
  v.literal("starting_image_prompt"),
  v.literal("starting_image_asset"),
  v.literal("style_reference"),
  v.literal("motion_reference"),
  v.literal("upscale_source"),
  v.literal("variation_source"),
  v.literal("edit_source"),
  v.literal("other"),
);

export const semanticSourceTypeValidator = v.union(
  v.literal("asset"),
  v.literal("prompt"),
  v.literal("designInspiration"),
);

export const semanticModalityValidator = v.union(
  v.literal("multimodal_image"),
  v.literal("text_only"),
);

export const semanticFailureStatusValidator = v.union(
  v.literal("pending"),
  v.literal("resolved"),
);

export const agentTokenScopeValidator = v.union(
  v.literal("gallery:read"),
  v.literal("gallery:write"),
  v.literal("gallery:delete"),
);

// Which layer (tab) of a project a member collection is filed under. A
// "direction" — a collection of similar options with a master cover — lives
// in exactly one of these layers per project. Undefined = unsorted.
export const projectSectionValidator = v.union(
  v.literal("characters"),
  v.literal("locations"),
  v.literal("stills"),
  v.literal("beats"),
);
export const optionalProjectSectionValidator = v.optional(
  projectSectionValidator,
);
