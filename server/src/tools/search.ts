import { create_logged_tool } from './decorators'
import { UnifiedSearchResultsWithImages } from './unified_search/unified_search_results_with_images'

export const LoggedUnifiedSearch = create_logged_tool(
  UnifiedSearchResultsWithImages,
)

export const get_web_search_tool = (max_search_results: number) => {
  return UnifiedSearchResultsWithImages
}
