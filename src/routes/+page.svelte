<script>
	import { onMount } from 'svelte';
	import { base } from '$app/paths';
	import ChoroplethMap from '$lib/components/ChoroplethMap.svelte';
	import ScrollNarrative from '$lib/components/ScrollNarrative.svelte';
	import { loadStoryData } from '$lib/utils/tractStoryModel.js';

	let model = null;
	let currentStep = 0;
	let loading = true;
	let error = '';

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

	onMount(async () => {
		try {
			model = await loadStoryData(base);
		} catch (err) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			loading = false;
		}
	});

	$: steps =
		model == null
			? []
			: [
					{
						kicker: 'Step 1',
						title: 'Housing growth was not evenly distributed across the state.',
						body: `The first view shows only net housing change by tract from 2000 to 2020. A small number of corridors added far more homes than the statewide background, while many tracts changed little. This establishes the base pattern before TOD categories enter the story.`,
						takeaway:
							'If growth is already spatially concentrated, then the policy question is not just whether Massachusetts built enough housing, but where that housing was allowed to land.'
					},
					{
						kicker: 'Step 2',
						title: `${model.summary.todDominatedCount} TOD-dominated tracts cluster most visibly around Greater Boston.`,
						body: `Adding tract categories separates places where transit-accessible projects made up most new development from places where growth was either outside that radius or too limited to matter. The strongest TOD cluster is in the eastern part of the state, especially around the Greater Boston transit corridor.`,
						takeaway:
							'TOD is not a statewide abstraction here. It is a specific geography of growth, and that means its equity effects will also be geographically uneven.'
					},
					{
						kicker: 'Step 3',
						title: `${model.summary.totalProjects} projects explain how those tract patterns were produced on the ground.`,
						body: `${Math.round(model.summary.todProjectShare * 100)}% of MassBuilds projects in this window fall within the TOD distance threshold used here. Overlaying those points turns the tract categories into something concrete: repeated project activity accumulates into tract-level change, especially in already transit-rich areas.`,
						takeaway:
							'This is why affordable housing policy has to be paired with TOD policy. The transit-accessible projects are real and spatially concentrated, so the distribution of affordability within them matters.'
					}
				];

	function handleStepChange(event) {
		currentStep = event.detail.index;
	}
</script>

<svelte:head>
	<title>TOD Choropleth Story</title>
	<meta
		name="description"
		content="A focused scroll-driven choropleth story about transit-oriented development, tract-level housing change, and where TOD clusters in Massachusetts."
	/>
</svelte:head>

<div class="page">
	<section class="hero">
		<div class="hero-copy card">
			<p class="eyebrow">Interactive Visualization Writeup</p>
			<h1>Where TOD changes the map of housing growth in Massachusetts.</h1>
			<p class="lede">
				Transit-oriented development is usually framed as a broadly positive planning strategy, and in many
				ways it is. The harder policy question is narrower: where is transit-accessible development actually
				concentrating, and what kind of neighborhood change tends to accompany it? This story focuses on that
				question with one tract-level choropleth and a tight scrollytelling structure.
			</p>
			<p class="hero-note">
				The writeup sections below include the design rationale, development process, and a
				<a href="#final-project-plan">final project plan</a>.
			</p>
		</div>
		<div class="hero-aside card">
			<div>
				<h2>What this visualization does</h2>
				<p>
					It starts with tract-level housing change, then layers in TOD tract categories, and finally reveals
					the MassBuilds projects that produce those patterns.
				</p>
			</div>
			<div>
				<h2>Core research question</h2>
				<p>
					How can policymakers encourage TOD while still paying attention to where growth concentrates and
					whether the benefits of that growth will be broadly shared?
				</p>
			</div>
		</div>
	</section>

	{#if loading}
		<section class="status card">
			<div class="spinner" aria-hidden="true"></div>
			<p>Loading tract geometry and project data…</p>
		</section>
	{:else if error}
		<section class="status card status--error">
			<h2>Could not load the choropleth story</h2>
			<p>{error}</p>
		</section>
	{:else}
		<section class="story-shell">
			<div class="map-column">
				<div class="sticky-wrap">
					<ChoroplethMap {model} {currentStep} />
				</div>
			</div>
			<div class="text-column">
				<ScrollNarrative {steps} {currentStep} sources={model.sources} on:stepchange={handleStepChange} />
			</div>
		</section>

		<section class="analysis card">
			<h2>Design rationale</h2>
			<ul>
				<li>The visualization uses a single choropleth because the communicative goal is to tell one story extremely clearly, not to ask the reader to compare multiple chart types.</li>
				<li>A diverging housing-change scale distinguishes tracts that added housing from tracts that changed little or lost units, which avoids flattening the story into a simple “more is darker” ramp.</li>
				<li>Step-based scrollytelling reveals complexity progressively: statewide housing change first, TOD categories second, then the individual project points that make those categories legible.</li>
				<li>The TOD and non-TOD outlines use a small set of strong categorical colors so the tract classes remain readable even after the choropleth is already carrying the quantitative signal.</li>
				<li>Tooltip hierarchy is intentionally restrained: title, category, two headline facts, then secondary details. That keeps hover interactions supportive instead of overwhelming.</li>
				<li>The strongest alternative considered was a fuller dashboard with scatterplots and filters, but that buried the main finding behind too much exploratory machinery for a policymaker-facing story.</li>
			</ul>
		</section>

		<section class="analysis card">
			<h2>Development process</h2>
			<ul>
				<li>This refactor sharply narrows the original scope by separating the tract scrollytelling map from the broader exploratory POC and removing unrelated chart modules, controls, and assets.</li>
				<li>The new standalone app keeps D3 only for projection, scales, and geometry calculations; the rest of the UI is rendered directly in Svelte so state changes are easier to reason about.</li>
				<li>The heaviest development tasks were simplifying the old dependency graph, re-expressing TOD classification locally, and turning a prototype-style map into a polished story-specific component.</li>
				<li>For the next milestone, the most important process improvement is to keep the visualization and the writeup coupled from the beginning so narrative decisions and implementation decisions do not drift apart.</li>
				<li>This piece is deliberately designed as the MVP story layer: one map, one interaction pattern, and one policy question done well.</li>
			</ul>
		</section>

		<section class="analysis card" id="final-project-plan">
			<h2>Final project plan</h2>
			<p class="plan-intro">
				This plan documents the remaining implementation order, task ownership, and fallback strategy for the full final project.
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
					If deadlines slip or a component proves too expensive to finish, the team will preserve the core tract story and cut secondary scope first. The most likely features to defer are supplementary comparative views, extra demographic slices, and richer exploratory controls. The fallback plan is to protect the main narrative, the tract map, and the policy framing before anything else.
				</p>
			</section>
		</section>
	{/if}
</div>

<style>
	.page {
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

	.hero {
		display: grid;
		grid-template-columns: minmax(0, 1.35fr) minmax(280px, 0.75fr);
		gap: 1.1rem;
		margin-bottom: 1.25rem;
	}

	.hero-copy,
	.hero-aside,
	.status,
	.analysis {
		padding: 1.5rem;
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

	.lede,
	.hero-note,
	.hero-aside p,
	.status p,
	.analysis li,
	.analysis p {
		color: var(--muted);
		line-height: 1.72;
	}

	.hero-note {
		margin-top: 1rem;
		font-size: 0.96rem;
	}

	.hero-aside {
		display: grid;
		gap: 1rem;
	}

	.hero-aside h2,
	.analysis h2 {
		margin-bottom: 0.6rem;
		font-size: 1.35rem;
	}

	.story-shell {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(320px, 0.72fr);
		gap: 1.4rem;
		align-items: start;
		margin-bottom: 1.4rem;
	}

	.sticky-wrap {
		position: sticky;
		top: 1rem;
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

	.analysis + .analysis {
		margin-top: 1rem;
	}

	.analysis ul {
		padding-left: 1.2rem;
	}

	.analysis li + li {
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
		.story-shell,
		.hero {
			grid-template-columns: 1fr;
		}

		.sticky-wrap {
			position: relative;
			top: auto;
		}
	}

	@media (max-width: 720px) {
		.page {
			padding-left: 0.9rem;
			padding-right: 0.9rem;
		}

		.hero-copy,
		.hero-aside,
		.status,
		.analysis {
			padding: 1.1rem;
		}

		.plan-people {
			grid-template-columns: 1fr;
		}
	}
</style>
