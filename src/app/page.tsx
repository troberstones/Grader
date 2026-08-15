import { getCourses } from "@/actions/courses";
import { PageContainer } from "@/components/layout/page-container";
import { Header } from "@/components/layout/header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkButton } from "@/components/ui/link-button";
import { BookOpen, ClipboardList, Grid3X3 } from "lucide-react";
import Link from "next/link";
import { formatTerm } from "@/lib/terms";

export default async function DashboardPage() {
  const allCourses = await getCourses();

  return (
    <PageContainer>
      <Header
        title="Dashboard"
        description="Welcome to Art Grader"
      />
      <div className="grid gap-4 md:grid-cols-3 mb-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Courses</CardTitle>
            <BookOpen className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{allCourses.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-2">
            <LinkButton href="/courses" variant="outline" size="sm" className="w-full justify-start">
              <BookOpen className="mr-2 h-4 w-4" />
              Manage Courses
            </LinkButton>
            <LinkButton href="/rubrics" variant="outline" size="sm" className="w-full justify-start">
              <Grid3X3 className="mr-2 h-4 w-4" />
              Manage Rubrics
            </LinkButton>
          </CardContent>
        </Card>
      </div>

      {allCourses.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold mb-3">Recent Courses</h3>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {allCourses.slice(0, 6).map((course) => (
              <Link key={course.id} href={`/courses/${course.id}`}>
                <Card className="hover:border-primary/50 transition-colors cursor-pointer">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">{course.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      {course.code} {course.section ? `- ${course.section}` : ""} &middot; {formatTerm(course.year, course.term)}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      )}
    </PageContainer>
  );
}
