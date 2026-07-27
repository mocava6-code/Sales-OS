import { describe, expect, it } from "vitest";
import { extractPageContent } from "../page-extraction";

describe("extractPageContent — boilerplate stripping", () => {
  it("strips nav/header/footer/script/style content entirely", () => {
    const html = `<html><head><title>Koriaki</title></head><body>
      <header><nav>Inicio | Catálogo | Contacto</nav></header>
      <main><h1>Kit TRAVO</h1><p>Compatible con Hilux Revo desde 2016.</p></main>
      <footer>Copyright 2026 Koriaki. Todos los derechos reservados.</footer>
      <script>trackEvent('pageview')</script>
      <style>.hero { color: red; }</style>
    </body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda/kit-travo");

    expect(result.fullText).not.toContain("Copyright");
    expect(result.fullText).not.toContain("Catálogo");
    expect(result.fullText).not.toContain("trackEvent");
    expect(result.fullText).toContain("Compatible con Hilux Revo desde 2016");
  });
});

describe("extractPageContent — section splitting", () => {
  it("splits into one section per heading, grouping paragraphs after it", () => {
    const html = `<html><body><main>
      <h2>Kit TRAVO</h2>
      <p>Compatible con Hilux Revo desde 2016.</p>
      <h2>Envíos</h2>
      <p>Para provincia enviamos por Shalom.</p>
    </main></body></html>`;

    const result = extractPageContent(html, "https://koriakiimport.com/tienda");

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]).toMatchObject({ heading: "Kit TRAVO", text: "Compatible con Hilux Revo desde 2016." });
    expect(result.sections[1]).toMatchObject({ heading: "Envíos", text: "Para provincia enviamos por Shalom." });
  });

  it("captures a heading-less leading section", () => {
    const html = `<html><body><main><p>Bienvenido a Koriaki.</p><h2>Servicios</h2><p>Instalación disponible.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");

    expect(result.sections[0]).toMatchObject({ heading: null, text: "Bienvenido a Koriaki." });
  });
});

describe("extractPageContent — context classification", () => {
  it("classifies a compatibility section as PRODUCT via keyword match", () => {
    const html = `<html><body><main><h2>Kit</h2><p>El TRAVO es compatible con Hilux Revo desde 2016.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    expect(result.sections[0].context).toBe("PRODUCT");
  });

  it("classifies a shipping section as SERVICE", () => {
    const html = `<html><body><main><h2>Envíos</h2><p>Para provincia enviamos por Shalom.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/servicios");
    expect(result.sections[0].context).toBe("SERVICE");
  });

  it("classifies a testimonial blockquote as TESTIMONIAL even on a PRODUCT-path URL", () => {
    const html = `<html><body><main>
      <h2>Kit TRAVO</h2><p>Compatible con Hilux Revo desde 2016.</p>
      <h3>Testimonio de cliente</h3><blockquote>Llegó en un día, excelente servicio.</blockquote>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda/kit-travo");

    const testimonialSection = result.sections.find((s) => s.text.includes("Llegó en un día"));
    expect(testimonialSection?.context).toBe("TESTIMONIAL");
    // The PRODUCT section on the same page/URL is unaffected.
    expect(result.sections[0].context).toBe("PRODUCT");
  });

  it("classifies marketing superlatives as MARKETING", () => {
    const html = `<html><body><main><h1>Bienvenido</h1><p>¡Somos líderes en kits para tu camioneta, la mejor calidad garantizada!</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");
    expect(result.sections[0].context).toBe("MARKETING");
  });

  it("falls back to the URL path hint when no section keyword matches", () => {
    const html = `<html><body><main><h2>Info</h2><p>Contenido genérico sin palabras clave particulares aquí.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/politica-de-garantia");
    expect(result.sections[0].context).toBe("POLICY");
  });

  it("falls back to UNKNOWN when neither section keywords nor URL hints match", () => {
    const html = `<html><body><main><h2>Info</h2><p>Contenido genérico sin palabras clave particulares aquí.</p></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/misc-page-xyz");
    expect(result.sections[0].context).toBe("UNKNOWN");
  });

  it("computes a dominant page-wide context by majority vote, ignoring UNKNOWN", () => {
    const html = `<html><body><main>
      <h2>A</h2><p>El TRAVO es compatible con Hilux Revo.</p>
      <h2>B</h2><p>El TRAVO también sirve para Fortuner compatible.</p>
      <h2>C</h2><p>Testimonio de cliente satisfecho.</p>
    </main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/tienda");
    expect(result.dominantContext).toBe("PRODUCT");
  });
});

describe("extractPageContent — links and title", () => {
  it("extracts the page title", () => {
    const html = `<html><head><title>Koriaki - Tienda</title></head><body><main><p>x</p></main></body></html>`;
    expect(extractPageContent(html, "https://koriakiimport.com/tienda").title).toBe("Koriaki - Tienda");
  });

  it("collects every href found on the page", () => {
    const html = `<html><body><main><a href="/tienda">Tienda</a><a href="https://external.com">Externo</a></main></body></html>`;
    const result = extractPageContent(html, "https://koriakiimport.com/");
    expect(result.links).toEqual(["/tienda", "https://external.com"]);
  });
});
