import { routeAcceptanceCases, routeQuestion } from "../src/lib/services/agent-router";
for (const [question, expected] of routeAcceptanceCases()) {
  const route = routeQuestion(question);
  const actual = [route.primaryDomain, ...route.secondaryDomains];
  console.log(JSON.stringify({ question, actual, expected }));
}
