\set ON_ERROR_STOP on
\if :{?username_prefix}
\else
  \echo 'Required psql variable missing: username_prefix'
  SELECT 1 / 0;
\endif
\if :{?since}
\else
  \echo 'Required psql variable missing: since (ISO-8601 timestamp)'
  SELECT 1 / 0;
\endif

WITH target_sessions AS (
  SELECT session.*
  FROM "GameSession" session
  JOIN "Account" account ON account.id = session."ownerAccountId"
  JOIN "Game" game ON game.id = session."gameId"
  WHERE left(account."usernameNormalized", length(:'username_prefix')) = :'username_prefix'
    AND game.slug = 'neon-mines'
    AND session."createdAt" >= :'since'::timestamptz
),
result_totals AS (
  SELECT result."gameSessionId", count(*) AS result_count, coalesce(sum(result.reward), 0) AS result_reward
  FROM "GameResult" result
  JOIN target_sessions session ON session.id = result."gameSessionId"
  GROUP BY result."gameSessionId"
),
participant_totals AS (
  SELECT participant."gameSessionId", count(*) AS participant_count,
         count(*) FILTER (WHERE participant."accountId" = session."ownerAccountId") AS owner_count
  FROM "GameSessionParticipant" participant
  JOIN target_sessions session ON session.id = participant."gameSessionId"
  GROUP BY participant."gameSessionId"
),
ledger_totals AS (
  SELECT session.id,
         count(*) FILTER (WHERE entry.type = 'GAME_ENTRY') AS entry_count,
         coalesce(sum(entry.amount) FILTER (WHERE entry.type = 'GAME_ENTRY'), 0) AS entry_total,
         count(*) FILTER (WHERE entry.type = 'GAME_REWARD') AS reward_count,
         coalesce(sum(entry.amount) FILTER (WHERE entry.type = 'GAME_REWARD'), 0) AS reward_total
  FROM target_sessions session
  LEFT JOIN "LedgerEntry" entry
    ON entry."referenceType" = 'GAME_SESSION' AND entry."referenceId" = session.id::text
  GROUP BY session.id
),
wallet_totals AS (
  SELECT wallet.id, wallet.balance, coalesce(sum(entry.amount), 0) AS ledger_total
  FROM "Wallet" wallet
  JOIN "Account" account ON account.id = wallet."accountId"
  LEFT JOIN "LedgerEntry" entry ON entry."walletId" = wallet.id
  WHERE left(account."usernameNormalized", length(:'username_prefix')) = :'username_prefix'
  GROUP BY wallet.id, wallet.balance
),
audit AS (
  SELECT count(*) AS rounds,
         count(*) FILTER (WHERE session.status <> 'COMPLETED') AS non_completed,
         count(*) FILTER (WHERE coalesce(result.result_count, 0) <> 1) AS bad_results,
         count(*) FILTER (WHERE coalesce(participant.participant_count, 0) <> 1 OR coalesce(participant.owner_count, 0) <> 1) AS bad_participants,
         count(*) FILTER (WHERE ledger.entry_count <> 1 OR ledger.entry_total <> -session."entryAmount") AS bad_entry_debits,
         count(*) FILTER (
           WHERE ledger.reward_count <> CASE WHEN coalesce(result.result_reward, 0) > 0 THEN 1 ELSE 0 END
              OR ledger.reward_total <> coalesce(result.result_reward, 0)
         ) AS bad_rewards,
         (SELECT count(*) FROM wallet_totals WHERE balance <> ledger_total) AS bad_wallet_balances
  FROM target_sessions session
  LEFT JOIN result_totals result ON result."gameSessionId" = session.id
  LEFT JOIN participant_totals participant ON participant."gameSessionId" = session.id
  JOIN ledger_totals ledger ON ledger.id = session.id
)
SELECT rounds, non_completed, bad_results, bad_participants, bad_entry_debits,
       bad_rewards, bad_wallet_balances,
       rounds > 0
         AND non_completed = 0
         AND bad_results = 0
         AND bad_participants = 0
         AND bad_entry_debits = 0
         AND bad_rewards = 0
         AND bad_wallet_balances = 0 AS audit_ok
FROM audit
\gset audit_

\echo 'rounds=' :audit_rounds
\echo 'non_completed=' :audit_non_completed
\echo 'bad_results=' :audit_bad_results
\echo 'bad_participants=' :audit_bad_participants
\echo 'bad_entry_debits=' :audit_bad_entry_debits
\echo 'bad_rewards=' :audit_bad_rewards
\echo 'bad_wallet_balances=' :audit_bad_wallet_balances
\if :audit_audit_ok
  \echo 'SETTLEMENT AUDIT PASSED'
\else
  \echo 'SETTLEMENT AUDIT FAILED — Neon Mines must remain disabled'
  SELECT 1 / CASE WHEN :'audit_audit_ok'::boolean THEN 1 ELSE 0 END;
\endif
