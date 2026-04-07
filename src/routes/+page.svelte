<script>
	import { onMount } from 'svelte';
	import {
		tractData,
		developments,
		loadAllData
	} from '$lib/stores/data.svelte.js';
	import { createPanelState } from '$lib/stores/panelState.svelte.js';
	import PocNhgisTractMap from '$lib/components/PocNhgisTractMap.svelte';
	import {
		DEFAULT_MAIN_POC_DEV_OPTS,
		DEFAULT_MAIN_POC_UNIVERSE,
		buildNhgisLikeRows,
		buildTractDevClassMap,
		filterDevelopmentsByYearRange,
		filterTractsForMainPoc,
		uniqueCounties
	} from '$lib/utils/mainPocTractModel.js';

	let loading = true;
	let error = '';
	let threshold = 0.5;

	const tractTimePeriod = '10_20';
	const tractSigDevMin = 2;
	const tractTodFractionCutoff = 0.5;

	const pocMapPanel = createPanelState('choropleth-story');

	const finalProjectPlan = [
		{
			week: 'Week 9: 3/30-4/3',
			overall: [
				'Polish one visualization',
				'Understand and justify design decisions',
				'Understand and learn from the development process'
			],
			people: {
				Allison: [
					'Make initial suggested edits to the current visualization',
					'Determine which demographic(s) are most illustrative of the main point',
					'Schedule and prepare for the office hours check-in'
				],
				Krishna: [
					'Make initial suggested edits to the current visualization',
					'Determine which demographic(s) are most illustrative of the main point',
					'Schedule and prepare for the office hours check-in'
				],
				Hanna: [
					'Parse and organize staff and classmate feedback',
					'Determine which demographic(s) are most illustrative of the main point',
					'Play around with and make edits to the revised visualization',
					'Schedule and prepare for the office hours check-in'
				],
				Supriya: [
					'Determine which demographic(s) are most illustrative of the main point',
					'Play around with and make edits to the revised visualization',
					'Schedule and prepare for the office hours check-in'
				]
			}
		},
		{
			week: 'Week 10: 4/6-4/10',
			overall: [
				'Finalize one visualization',
				'Start working on the minimal viable product',
				'Complete the office hours check-in'
			],
			people: {
				Allison: ['Implement changes in the edited visualization', 'Complete the office hours check-in'],
				Krishna: ['Implement changes in the edited visualization', 'Complete the office hours check-in'],
				Hanna: [
					'Finalize feedback for the initial edit of the visualization',
					'Implement changes in the edited visualization',
					'Complete the office hours check-in'
				],
				Supriya: [
					'Finalize feedback for the initial edit of the visualization',
					'Complete the office hours check-in'
				]
			}
		},
		{
			week: 'Week 11: 4/13-4/17',
			overall: [
				'Have satisfactory demos for the minimal viable product',
				'Have satisfactory progress on the presentation of the minimal viable product'
			],
			people: {
				Allison: [
					'Work on the data visualization interaction part of the presentation',
					'Collaboratively and individually make changes to demos'
				],
				Krishna: [
					'Work on the data visualization interpretation part of the presentation',
					'Collaboratively and individually make changes to demos'
				],
				Hanna: [
					'Work on the introduction, motivation, and sources part of the presentation',
					'Collaboratively and individually make changes to demos'
				],
				Supriya: [
					'Work on the audience and main goals part of the presentation',
					'Collaboratively and individually make changes to demos'
				]
			}
		},
		{
			week: 'Week 12: 4/20-4/24',
			overall: [
				'Finish the minimal viable product',
				'Finalize and record the presentation',
				"Start exploration of other teams' projects and begin thinking about critique"
			],
			people: {
				Allison: [
					'Finalize the minimal viable product',
					'Record the presentation',
					"Start exploration of other teams' projects and begin thinking about critique"
				],
				Krishna: [
					'Finalize the minimal viable product',
					'Record the presentation',
					"Start exploration of other teams' projects and begin thinking about critique"
				],
				Hanna: [
					'Finalize the minimal viable product',
					'Record the presentation',
					"Start exploration of other teams' projects and begin thinking about critique"
				],
				Supriya: [
					'Finalize the minimal viable product',
					'Record the presentation',
					"Start exploration of other teams' projects and begin thinking about critique"
				]
			}
		},
		{
			week: 'Week 13: 4/27-5/1',
			overall: ['Finalize critique for other teams', 'Keep looking over final products'],
			people: {
				Allison: ['Write critique for other teams', 'Keep looking over final products'],
				Krishna: ['Write critique for other teams', 'Keep looking over final products'],
				Hanna: ['Write critique for other teams', 'Keep looking over final products'],
				Supriya: ['Write critique for other teams', 'Keep looking over final products']
			}
		},
		{
			week: 'Week 14: 5/4-5/8',
			overall: ['Integrate provided feedback', 'Mostly finalize the final project'],
			people: {
				Allison: ['Integrate changes from feedback and iterate'],
				Krishna: ['Integrate changes from feedback and iterate'],
				Hanna: ['Parse and organize feedback', 'Integrate changes from feedback and iterate'],
				Supriya: ['Integrate changes from feedback and iterate']
			}
		},
		{
			week: 'Week 15: 5/11',
			overall: ['Finish the final project'],
			people: {
				Allison: ['Final walkthrough evaluation of the project'],
				Krishna: ['Final walkthrough evaluation of the project'],
				Hanna: ['Final walkthrough evaluation of the project'],
				Supriya: ['Final walkthrough evaluation of the project']
			}
		}
	];

	function syncPanelDefaults() {
		pocMapPanel.transitDistanceMi = threshold;
		pocMapPanel.timePeriod = tractTimePeriod;
		pocMapPanel.minStops = DEFAULT_MAIN_POC_UNIVERSE.minStops;
		pocMapPanel.sigDevMinPctStockIncrease = tractSigDevMin;
		pocMapPanel.todFractionCutoff = tractTodFractionCutoff;
		pocMapPanel.huChangeSource = 'massbuilds';
		pocMapPanel.minPopulation = DEFAULT_MAIN_POC_UNIVERSE.minPopulation;
		pocMapPanel.minPopDensity = DEFAULT_MAIN_POC_UNIVERSE.minPopDensity;
		pocMapPanel.minUnitsPerProject = DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject;
		pocMapPanel.minDevMultifamilyRatioPct = DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct;
		pocMapPanel.minDevAffordableRatioPct = DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct;
		pocMapPanel.includeRedevelopment = DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment;
	}

	$: syncPanelDefaults();

	$: tractDevOpts = {
		minUnitsPerProject: DEFAULT_MAIN_POC_DEV_OPTS.minUnitsPerProject,
		minDevMultifamilyRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevMultifamilyRatioPct,
		minDevAffordableRatioPct: DEFAULT_MAIN_POC_DEV_OPTS.minDevAffordableRatioPct,
		includeRedevelopment: DEFAULT_MAIN_POC_DEV_OPTS.includeRedevelopment
	};

	$: tractCounties = tractData.length ? new Set(uniqueCounties(tractData)) : new Set();

	$: tractListFiltered = tractData.length
		? filterTractsForMainPoc(tractData, tractCounties, '', {
				timePeriod: tractTimePeriod,
				minStops: DEFAULT_MAIN_POC_UNIVERSE.minStops,
				minPopulation: DEFAULT_MAIN_POC_UNIVERSE.minPopulation,
				minPopDensity: DEFAULT_MAIN_POC_UNIVERSE.minPopDensity
			})
		: [];

	$: tractWindowDevs = filterDevelopmentsByYearRange(developments, 1990, 2026, tractDevOpts);

	$: tractDevClassByGj = buildTractDevClassMap(
		tractListFiltered,
		tractWindowDevs,
		{
			timePeriod: tractTimePeriod,
			minStops: DEFAULT_MAIN_POC_UNIVERSE.minStops,
			minPopulation: DEFAULT_MAIN_POC_UNIVERSE.minPopulation,
			minPopDensity: DEFAULT_MAIN_POC_UNIVERSE.minPopDensity
		},
		threshold,
		tractDevOpts,
		tractSigDevMin,
		tractTodFractionCutoff
	);

	$: nhgisLikeRows = buildNhgisLikeRows(tractListFiltered, tractDevClassByGj);

	onMount(async () => {
		try {
			await loadAllData();
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	});
</script>

<svelte:head>
	<title>TOD Choropleth Story</title>
	<meta
		name="description"
		content="A focused tract-level scrollytelling map about housing growth, TOD-dominated tracts, and project concentration in Massachusetts."
	/>
</svelte:head>

<div class="poc-root">
	<section class="hero-full card">
			<p class="eyebrow">Interactive Visualization Writeup</p>
			<h1>Where TOD changes the map of housing growth in Massachusetts.</h1>
			<p class="subtitle">
				This version is intentionally narrow. Instead of a dashboard with many competing views, it uses the
				exact tract scrollytelling map from the original proof of concept and frames it as one data story about
				where transit-oriented development clusters, how those tracts differ from the statewide background, and
				why that matters for affordable housing policy.
			</p>
			<p class="hero-note">
				The final project plan is included at the end of this writeup:
				<a href="#final-project-plan">jump to the plan</a>.
			</p>
	</section>

	{#if loading}
		<section class="status card">
			<div class="spinner" aria-hidden="true"></div>
			<p>Loading tract geometry and development data…</p>
		</section>
	{:else if error}
		<section class="status card status--error">
			<h2>Could not load the tract story</h2>
			<p>{error}</p>
		</section>
	{:else}
		<section class="story card full-width">
			<h2>Why this one map is enough for the proof of concept</h2>
			<p>
				The most important interaction in this milestone is not a filter panel or a dashboard of linked charts.
				It is the act of revealing the map in layers. Step one shows where housing change happened. Step two
				separates TOD-dominated tracts from non-TOD and minimal-development tracts. Step three ties those tract
				patterns back to the underlying MassBuilds projects.
			</p>
			<p>
				That sequencing is what makes the visualization communicative rather than merely exploratory. It guides
				the viewer toward the policy claim instead of making them assemble the argument on their own.
			</p>
		</section>

		<section class="chart-card card full-width">
			<h3>Tract categorizations and housing change overview (tract, 2010–20 window)</h3>
			<p class="chart-note">
				Tracts are colored by <strong>census percent change in housing units (2010–20)</strong> and outlined by
				MassBuilds cohort (TOD-dominated vs non-TOD-dominated vs minimal development), matching the tract
				dashboard rules. The narrative built into the map progressively introduces tract outlines and the
				MassBuilds developments that produce those tract-level patterns.
			</p>
			<div class="chart-wrap chart-tall chart-wrap--poc-map">
				<PocNhgisTractMap
					panelState={pocMapPanel}
					tractList={tractListFiltered}
					nhgisRows={nhgisLikeRows}
					metricsDevelopments={tractWindowDevs}
				/>
			</div>
		</section>

		<section class="story card full-width">
			<h2>Design rationale</h2>
			<ul>
				<li>This app keeps the exact tract scrollytelling map from the original `tod-d3-poc` because that map already carried the most compelling interaction technique in the project.</li>
				<li>The choropleth is the primary quantitative encoding, while the TOD versus non-TOD outlines act as a second layer of interpretation rather than a competing chart.</li>
				<li>The scroll-driven steps are the core storytelling device: they stage the visual evidence in a deliberate order so the reader is not overwhelmed at first glance.</li>
				<li>Keeping one high-quality map is more effective for this milestone than including multiple supporting charts that divide attention and weaken the narrative.</li>
				<li>The intended audience is policy-oriented, so the surrounding text is written to interpret the map and connect it to housing and affordability questions instead of leaving it as raw spatial exploration.</li>
			</ul>
		</section>

		<section class="story card full-width">
			<h2>Development process</h2>
			<ul>
				<li>The main process decision was to aggressively reduce scope: preserve the tract map interaction that already worked, remove unrelated views, and rebuild the presentation around that single component.</li>
				<li>The most time-consuming part of the refactor was isolating the exact map dependencies from the larger project so the story app could reuse the live component without dragging in the full dashboard.</li>
				<li>This standalone version improves the development process for later milestones because it creates a clean boundary between the narrative proof of concept and the broader exploratory workspace.</li>
				<li>If the team improves anything next, it should be deciding earlier which interactions belong to the final story and which ones are only useful during internal exploration.</li>
			</ul>
		</section>

		<section class="story card full-width" id="final-project-plan">
			<h2>Final project plan</h2>
			<p class="plan-intro">
				This plan documents the week-by-week order of work, team ownership, and the fallback strategy if scope needs to tighten further.
			</p>
			<div class="plan-grid">
				{#each finalProjectPlan as week (week.week)}
					<section class="plan-week">
						<h3>{week.week}</h3>
						<div class="plan-block">
							<h4>Overall</h4>
							<ul>
								{#each week.overall as item}
									<li>{item}</li>
								{/each}
							</ul>
						</div>
						<div class="plan-people">
							{#each Object.entries(week.people) as [name, tasks]}
								<div class="plan-person">
									<h4>{name}</h4>
									<ul>
										{#each tasks as task}
											<li>{task}</li>
										{/each}
									</ul>
								</div>
							{/each}
						</div>
					</section>
				{/each}
			</div>
			<section class="plan-contingency">
				<h3>If something goes wrong</h3>
				<p>
					If implementation time gets squeezed, the team should keep this tract story intact and drop secondary comparative views before cutting the core narrative. The first things to defer would be additional demographic breakouts, extra linked charts, and richer exploratory controls. The protected scope is the tract map, the step-based interaction, and the affordability-oriented policy framing around it.
				</p>
			</section>
		</section>
	{/if}
</div>

<style>
	.poc-root {
		max-width: var(--max-width);
		margin: 0 auto;
		padding: 2rem 1.25rem 4rem;
	}

	.card {
		background: var(--paper);
		border: 1px solid rgba(120, 114, 102, 0.18);
		border-radius: var(--radius-xl);
		box-shadow: var(--shadow);
	}

	.hero-full {
		padding: 1.75rem;
		margin-bottom: 1.25rem;
	}

	.eyebrow {
		display: inline-flex;
		margin-bottom: 0.9rem;
		padding: 0.45rem 0.72rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	h1 {
		margin-bottom: 1rem;
		font-size: clamp(2.5rem, 5vw, 4.6rem);
		line-height: 0.98;
		letter-spacing: -0.05em;
	}

	.subtitle {
		color: var(--muted);
		line-height: 1.58;
		margin-bottom: 0;
	}

	.story,
	.status {
		padding: 18px;
	}

	.story h2,
	.story h3 {
		margin-bottom: 0.6rem;
		font-size: 1.2rem;
	}

	.hero-note,
	.story p,
	.status p,
	.story li {
		color: var(--muted);
		line-height: 1.58;
	}

	.hero-note {
		margin-top: 1rem;
		font-size: 0.96rem;
	}

	.full-width {
		width: 100%;
	}

	.chart-card {
		padding: 16px;
	}

	.chart-card h3 {
		font-size: 1.05rem;
		margin-bottom: 8px;
	}

	.chart-note {
		color: var(--muted);
		line-height: 1.55;
		font-size: 0.9rem;
		margin-bottom: 8px;
	}

	.chart-wrap {
		position: relative;
		min-height: 420px;
	}

	.chart-tall {
		min-height: 520px;
	}

	.chart-wrap--poc-map {
		width: 80%;
		max-width: 100%;
		margin-left: auto;
		margin-right: auto;
	}

	.story,
	.chart-card,
	.status {
		margin-top: 1rem;
	}

	.status {
		display: grid;
		place-items: center;
		gap: 0.8rem;
		min-height: 240px;
		text-align: center;
	}

	.status--error {
		place-items: start;
		text-align: left;
	}

	.spinner {
		width: 2rem;
		height: 2rem;
		border-radius: 50%;
		border: 3px solid rgba(10, 111, 70, 0.15);
		border-top-color: var(--accent);
		animation: spin 0.8s linear infinite;
	}

	.story ul {
		padding-left: 1.2rem;
	}

	.story li + li {
		margin-top: 0.5rem;
	}

	.plan-intro {
		margin-bottom: 1rem;
	}

	.plan-grid {
		display: grid;
		gap: 0.9rem;
	}

	.plan-week {
		padding: 1rem 1.05rem;
		border: 1px solid var(--line);
		border-radius: var(--radius-md);
		background: #faf7f1;
	}

	.plan-week h3 {
		margin-bottom: 0.8rem;
		font-size: 1.05rem;
	}

	.plan-week h4 {
		margin-bottom: 0.45rem;
		font-size: 0.92rem;
	}

	.plan-block + .plan-people {
		margin-top: 0.8rem;
		padding-top: 0.8rem;
		border-top: 1px solid var(--line);
	}

	.plan-people {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.8rem;
	}

	.plan-week ul {
		padding-left: 1.1rem;
		color: var(--muted);
	}

	.plan-contingency {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--line);
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (max-width: 1100px) {
		.poc-root {
			padding-left: 0.9rem;
			padding-right: 0.9rem;
		}
	}

	@media (max-width: 720px) {
		.hero-full,
		.story,
		.chart-card,
		.status {
			padding: 1.1rem;
		}

		.plan-people {
			grid-template-columns: 1fr;
		}
	}
</style>
