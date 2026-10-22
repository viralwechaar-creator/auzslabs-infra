-- Safety nets for the API's database role: a runaway query is stopped after 60 s (long imports run in chunks well under that),
-- and a connection left open inside an unfinished transaction is closed after 30 s, so one stuck request cannot hold the pool.
alter role app set statement_timeout = '60s';
alter role app set idle_in_transaction_session_timeout = '30s';
alter role app set lock_timeout = '15s';
