-- Knowledge search understands everyday words (20261001000600).
-- Word handling only: which chunks a role may read is covered by the RLS tests.
begin;
select plan(9);

select is(
  (select array_agg(term order by term) from orbit.knowledge_question_terms('how much insurance are claimed')),
  array['claim', 'insur'],
  'filler ("much") and stop words are dropped; "claimed" and "insurance" remain'
);

select ok(
  (select matches @> array['insur', 'payer'] from orbit.knowledge_question_terms('how much insurance are claimed') where term = 'claim'),
  '"claimed" may match insurance and payer'
);

select ok(
  (select matches @> array['incom', 'revenu', 'bill', 'collect'] from orbit.knowledge_question_terms('how was income') where term = 'incom'),
  '"income" may match revenue, billing and collections, and itself'
);

select is(
  (select matches from orbit.knowledge_question_terms('ward') where term = 'ward'),
  array['ward'],
  'an unlisted word matches only itself'
);

select is(
  (select count(*)::int from orbit.knowledge_question_terms('tell me how much')),
  0,
  'a question of only filler words has nothing to search for'
);

select is(
  (select count(*)::int from orbit.knowledge_search_words where filler and cardinality(equivalent) > 0),
  0,
  'a filler word has no equivalents'
);

-- A chunk that says "Insurance covered" but never "claimed" is now found by
-- word search alone (no embedding), as the corporate revenue lead's question needed.
create temporary table _chunk on commit drop as
  select to_tsvector('english', 'Billing and collections. Insurance covered 58.0 percent; patients owed the rest.') as fts;

select ok(
  (select (select count(*) from orbit.knowledge_question_terms('how much insurance are claimed') t
           where c.fts @@ to_tsquery('simple', array_to_string(t.matches, ' | ')))::float
          / (select count(*) from orbit.knowledge_question_terms('how much insurance are claimed')) >= 0.5
   from _chunk c),
  'the billing chunk covers at least half of "how much insurance are claimed"'
);

select ok(
  (select c.fts @@ to_tsquery('simple', array_to_string(t.matches, ' | '))
   from _chunk c, orbit.knowledge_question_terms('how was income') t),
  'the billing chunk matches "how was income"'
);

select ok(
  has_function_privilege('orbit_app', 'orbit.knowledge_question_terms(text)', 'execute')
  and has_table_privilege('orbit_app', 'orbit.knowledge_search_words', 'select')
  and not has_table_privilege('orbit_app', 'orbit.knowledge_search_words', 'insert'),
  'orbit_app may read the word list and call the function, but not change the list'
);

select * from finish();
rollback;
