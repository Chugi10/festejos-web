# Copia de la web de Festejos L'Entregu

Copia fija de la web pública de la Asociación de Festejos de L'Entregu (AFLEN), que se sirve desde
GitHub Pages para que la web no dependa de un solo proveedor.

- La web **se edita en la gestión** (Panel → Web), como siempre. Aquí no se toca nada a mano.
- `generar.mjs` pide cada página a la gestión y la guarda en `_site/` con sus fotos, letras y vídeos.
  Si algo falla, no se publica y se queda la copia anterior.
- `.github/workflows/copia.yml` la rehace cuando la web cambia (lo mira cada 10 minutos) o a mano
  (Actions → «Copia de la web» → Run workflow).
- El formulario de contacto y el contador de visitas siguen en la gestión.

Configuración del repositorio: secreto `COPIA_SECRETO` (el mismo que en la gestión) y variables
`ORIGEN` (dirección workers.dev de la gestión), `DOMINIO` (donde se sirve la copia) y `PRUEBA`
(`1` = copia de prueba, fuera de Google).
