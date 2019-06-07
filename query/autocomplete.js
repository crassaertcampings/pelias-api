const peliasQuery = require('pelias-query');
const defaults = require('./autocomplete_defaults');
const textParser = require('./text_parser_pelias');
const check = require('check-types');
const logger = require('pelias-logger').get('api');
const config = require('pelias-config').generate();
const placeTypes = require('../helper/placeTypes');

// additional views (these may be merged in to pelias/query at a later date)
var views = {
  custom_boosts:              require('./view/boost_sources_and_layers'),
  ngrams_strict:              require('./view/ngrams_strict'),
  ngrams_last_token_only:     require('./view/ngrams_last_token_only'),
  ngrams_last_token_only_multi: require('./view/ngrams_last_token_only_multi'),
  admin_multi_match_first: require('./view/admin_multi_match_first'),
  admin_multi_match_last: require('./view/admin_multi_match_last'),
  phrase_first_tokens_only:   require('./view/phrase_first_tokens_only'),
  pop_subquery:               require('./view/pop_subquery'),
  boost_exact_matches:        require('./view/boost_exact_matches'),
  max_character_count_layer_filter:   require('./view/max_character_count_layer_filter'),
  focus_point_filter:         require('./view/focus_point_distance_filter')
};

// add abbrevations for the fields pelias/parser is able to detect.
var adminFields = placeTypes.concat(['locality_a', 'region_a', 'country_a']);

// add name field to improve venue matching
adminFields = adminFields.concat(['add_name_to_multimatch']);

//------------------------------
// autocomplete query
//------------------------------
var query = new peliasQuery.layout.FilteredBooleanQuery();

// mandatory matches
query.score( views.phrase_first_tokens_only, 'must' );
query.score( views.ngrams_last_token_only_multi( adminFields ), 'must' );

// admin components
query.score( views.admin_multi_match_first( adminFields ), 'must');
query.score( views.admin_multi_match_last( adminFields ), 'must');

// address components
query.score( peliasQuery.view.address('housenumber') );
query.score( peliasQuery.view.address('street') );
query.score( peliasQuery.view.address('cross_street') );
query.score( peliasQuery.view.address('postcode') );

// scoring boost
query.score( peliasQuery.view.focus( views.ngrams_strict ) );
query.score( peliasQuery.view.popularity( views.pop_subquery ) );
query.score( peliasQuery.view.population( views.pop_subquery ) );
query.score( views.custom_boosts( config.get('api.customBoosts') ) );

// non-scoring hard filters
query.filter( views.max_character_count_layer_filter(['address'], config.get('api.autocomplete.exclude_address_length' ) ) );
query.filter( peliasQuery.view.sources );
query.filter( peliasQuery.view.layers );
query.filter( peliasQuery.view.boundary_rect );
query.filter( peliasQuery.view.boundary_circle );
query.filter( peliasQuery.view.boundary_country );
query.filter( peliasQuery.view.categories );
query.filter( peliasQuery.view.boundary_gid );
query.filter( views.focus_point_filter );

// --------------------------------

/**
  map request variables to query variables for all inputs
  provided by this HTTP request.
**/
function generateQuery( clean ){

  const vs = new peliasQuery.Vars( defaults );

  // sources
  if( check.array(clean.sources) && clean.sources.length ){
    vs.var( 'sources', clean.sources );
  }

  // layers
  if( check.array(clean.layers) && clean.layers.length ){
    vs.var( 'layers', clean.layers);
  }

  // boundary country
  if( check.nonEmptyArray(clean['boundary.country']) ){
    vs.set({
      'boundary:country': clean['boundary.country'].join(' ')
    });
  }

  // pass the input tokens to the views so they can choose which tokens
  // are relevant for their specific function.
  if( check.array( clean.tokens ) ){
    vs.var( 'input:name:tokens', clean.tokens );
    vs.var( 'input:name:tokens_complete', clean.tokens_complete );
    vs.var( 'input:name:tokens_incomplete', clean.tokens_incomplete );
  }

  // input text
  vs.var( 'input:name', clean.text );

  // if the tokenizer has run then we set 'input:name' to as the combination of the
  // 'complete' tokens with the 'incomplete' tokens, the resuting array differs
  // slightly from the 'input:name:tokens' array as some tokens might have been
  // removed in the process; such as single grams which are not present in then
  // ngrams index.
  if( check.array( clean.tokens_complete ) && check.array( clean.tokens_incomplete ) ){
    var combined = clean.tokens_complete.concat( clean.tokens_incomplete );
    if( combined.length ){
      vs.var( 'input:name', combined.join(' ') );
    }
  }

  // focus point
  if( check.number(clean['focus.point.lat']) &&
      check.number(clean['focus.point.lon']) ){
    vs.set({
      'focus:point:lat': clean['focus.point.lat'],
      'focus:point:lon': clean['focus.point.lon']
    });
  }

  // boundary rect
  if( check.number(clean['boundary.rect.min_lat']) &&
      check.number(clean['boundary.rect.max_lat']) &&
      check.number(clean['boundary.rect.min_lon']) &&
      check.number(clean['boundary.rect.max_lon']) ){
    vs.set({
      'boundary:rect:top': clean['boundary.rect.max_lat'],
      'boundary:rect:right': clean['boundary.rect.max_lon'],
      'boundary:rect:bottom': clean['boundary.rect.min_lat'],
      'boundary:rect:left': clean['boundary.rect.min_lon']
    });
  }

  // boundary circle
  // @todo: change these to the correct request variable names
  if( check.number(clean['boundary.circle.lat']) &&
      check.number(clean['boundary.circle.lon']) ){
    vs.set({
      'boundary:circle:lat': clean['boundary.circle.lat'],
      'boundary:circle:lon': clean['boundary.circle.lon']
    });

    if( check.number(clean['boundary.circle.radius']) ){
      vs.set({
        'boundary:circle:radius': Math.round( clean['boundary.circle.radius'] ) + 'km'
      });
    }
  }

  // boundary gid
  if( check.string(clean['boundary.gid']) ){
    vs.set({
      'boundary:gid': clean['boundary.gid']
    });
  }

  // categories
  if (clean.categories && clean.categories.length) {
    vs.var('input:categories', clean.categories);
  }

  // run the address parser
  if( clean.parsed_text ){
    textParser( clean, vs );
  }

  let isAdminSet = adminFields.some(field => vs.isset('input:' + field));
  if ( isAdminSet ){ vs.var('input:add_name_to_multimatch', 'enabled'); }

  vs.var('admin:add_name_to_multimatch:field', 'name.default');

  return {
    type: 'autocomplete',
    body: query.render(vs)
  };
}

module.exports = generateQuery;
