// The page's one script. The page's stylesheet is linked from index.html; the
// scenes load on demand from mountScenes, the moments pin from pinMoments.
// Everything here only adds to a page that already works without it.
import { mountScenes } from './stage/mount'
import { closeMenus, pinMoments } from './moments'

pinMoments()
closeMenus()
mountScenes()
