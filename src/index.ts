export {
  compileTemplate,
  compileTemplateToString,
  type CompiledTemplate,
  type CompileTemplateOptions,
} from "./compiler.ts";

export { hasTemplateSyntax } from "./parser.ts";

export {
  renderToResponse,
  createRenderContext,
  RENDER_CONTEXT_KEYS,
  type RenderContext,
  type RenderOptions,
} from "./render.ts";
